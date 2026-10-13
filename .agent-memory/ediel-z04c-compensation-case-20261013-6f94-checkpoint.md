# Ediel Z04C: kompensationsärende och varning, 6f94

Ägare `codex-ediel-z04c-compensation-case-20261013-6f94`, packet `a024ccc4-0148-4a8a-9d8d-7284f84a0446`. Egen branch `codex/ediel-z04c-compensation-case-20261013-6f94`, isolerad arbetsyta `/workspace/ediel-z04c-compensation-case-20261013-6f94`. Root skriver endast detta unika checkpoint; solewriter `/root/z06fg_requirements` äger den enda nya testfilen efter självständig custody-verifiering.

## Faktisk källa och levererad bas

Paketet börjar från faktisk main `d798eb36f35cd4f437d44c8d234b4dbb81adc7a6`, tree `e3b6c11677a2b871a128504f1616def7d22dba1e`, ordnade föräldrar `[95d8d160491e79b172342654d8dc643346758105, fba453cc7cc9de8a26ec75d29248e1733316fcd1]`. PR #800 CLOSED/MERGED vid 2026-10-13T15:19:56Z och faktisk main-ref, commit/tree/föräldrar, terminala 18 kontroller (9 SUCCESS, 9 kvalificerade SKIP) samt gitpinnad ledger är separat verifierade. Ledger SHA256 `7266ee57be5ac633ec0e8ca3f169aaf7d048da45ca0abfc6004284eae75c822e`: **119 VERIFIED + 204 PASSED = 323/352**. Det är befintlig seriell ägares leverans av SC-035 och Z02L/LK, inte vårt källarbete. [Verifierat kvitto](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149009842). AT-Z04C och AT-Z03C är fortsatt NOT_EXECUTED.

95d→d798 ändrar fyra proof/checkpoint/archive/ledgerfiler. Produkt-, SQL-, helper-, konfigurations-, krav- och typbytes är oförändrade. Arkivets original har inte hämtats eller öppnats av oss; befintlig collector behåller custody. Historiska 320 och 95d i tidigare läsrapporter är daterade källvärden, ingen konkurrerande aktuell ledger eller dispatch.

FG-källpaketet är publicerat vid `0dbc3101138e6ebe041bc280d9f7b68e4876e0ce`/tree `989dd2927f4acd9f783cb6644a0b971078153ec7`, två oberoende final SOURCE_APPROVE och [konkret överlämning6147700001](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6147700001). Z09F/G är publicerat vid `76a6114f14620c04ea5c3cc72733eaec4f13609d`/tree `03723e46fe82859390a0626417ac317e451e77e6`, två final SOURCE_APPROVE och [överlämning6148968370](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6148968370). Båda förblir source-only, native NOT_RUN, pausade med hållna refs3f4/db3d tills korrekt mottagarcustody. Detta nya paket utgår direkt från faktisk d798 och ändrar inget av deras postbilder eller checkpoints.

## Kravlucka och exakt avgränsning

Frysta AT-Z04C för redan verkställd effekt kräver kontrollerad kompensation. Befintlig source stöder detta: verklig `inboundProcessing` för C/Z24 gör source-apply, skiljer held/applied partitioner, avstår slutligt domain-ACK och Legacyprojection för oapplicerade objekt, skapar faktisk sourcebunden inboundcase och skriver validated warning med eget caseId och sourceObjectPartition. Detta är ingen bekräftad saknad produktfunktion.

Befintligt coordinatorprov använder Z04L och mockar casewriter. Äldre C-prov mockar Legacy/RPC/workflow. De komponerar inte just C/Z24 held-kompensationsobjekt genom verklig koordinator och verklig case-/varningspersistens. Två oberoende läsande traces har identifierat samma avgränsade assertionslucka; huvudstöd [6147545538](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6147545538).

Den nya enda filen ska testa dessa verkliga caller/casefunktioner med uttryckligen deklarerade begränsade lägre SQL/provenance/tabellportar. Kontrollerna gäller eget source/company/object/rawscope, sourcebundet ärende och precis granskningsvarning, frånvaro av native effect/final ACK/automatisk kompensation eller aktivering, samt bevarade terminala review-/objectApplication-beslut, tenantfilter, CAS och replay. Ingen casewriter som enbart mockas till önskat resultat. Portstorage och modellerad lägre sourceauktoritet blir inte genuina DB-/native-/physicalbevis.

Komponenten bevisar inte hela AT-Z04C, fysisk cancellation-first→senare original, färdig kompensation, verklig operatörsauktoritet eller aktuell CI/GEN. Z03C har ett befintligt kompositionsunderlag för qualification hos solecollector; inget extra historiskt L4-nativekrav införs. Inga nya approvalAPI/LIVE/marknadsgates, inga produktfixar utan konkret sourcefel och ingen artificial RED för redan implementerat beteende.

## Verifierad custody och namngiven skrivare

Exakt ny path `__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts`, ref `file-d3f2acb77bb1d7a3c265a2a1bb5fd8b4e24e89effed813b956b22aa1bae4ae34`. Neutral receipt `359d27a100e3f5de4992e5abd921060c85988ae4`, exact maintreee3b6 och enda parentd798, helpermetadata/IDs tomma. Root har utfört sorterad one-resource CREATE_IF_ABSENT och autentiserad GET_MATCH samt hela receiptJSON MATCH innan sourcewrite. [CLAIM6149092334](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149092334).

Availability omfattar 192 aktiva refs/56 fulla payloads utan läsfel, samtliga fem då öppna PR:ers 647 paths, relevanta stängda cancellationpathsets, aktuella whole-task/directory/file/ID/slot/producerreservationer och uttryckliga senaste överlämningar. Ingen samma-criterion writer/preparedscope. Detta är inte en slutsats enbart från fil-/ID404. Root förnyade faktiskmain, egen exaktref404 och senaste #766 genom ROOT6149004435/egen6149009842 innan acquire; sourcepath är absent på main och i den nya rena arbetsytan.

Root PAUSAR testpath. Solewriter `/root/z06fg_requirements` måste autentisera fullreceipt/ref/source/tree/branch/pathabsence självständigt före första write. Root skriver bara detta eget unika checkpoint. Verklig caller/case/SQL/helper/andra testfiler och runtimeC1ec78/051ec är endast läsberoenden; deras custody tas inte över. Medförfattare och provrunner granskar inte sin egen slutversion. Två andra oberoende finalpeers ska bindas till sluthead/source/base/tree/ordnade föräldrar innan sourcepublication.

## Verifiering och nästa steg

Låsta package.json/package-lock är exakt samma som föregående arbetsyta. Befintliga 471 låsta dependencies används via lässymlink; Node22.23.3 finns redan. Inga nya dependencies eller backend installeras. Helper ska verifiera precis relevant finit test, en-fils lint och lämplig avgränsad TypeScript, spara originalstdout/stderr och eventuell controller från första körningen samt hashbinda dem i sourcequalification. Oförändrade gröna kontroller körs inte om för dokumentationsbevis.

Nästa: helper egen readback → konkret finit portplan → enda sourcefilen och relevanta verifieringar → fryst code/PAUSED → root eget checkpoint → två andra finalpeers → kontrollerad källbranch och konkret bounded handoff till befintlig seriell ROOT. Native/GEN/backend/original/CI/normalmainmerge ägs fortsatt av befintliga kvalificerade ägare. Inga verkliga utskick, retentiongallringar eller produktionsaktiveringar. Inga gamla agentstarter, pausade automationer eller tidigare nekade releases återupptas. Pending privata publiceringsgodkännanden och källor respekteras.

## Ordagrant fryst krav

```json
{
  "id": "AT-Z04C-SUPPLIER",
  "name": "Meddelandefall Z04C",
  "given": "SUPPLIER; Bevara original- och kancelleringsordning; kancellering före original lagras för begränsad korrelation, ingen godtycklig aktivering.",
  "when": "Bekräftelse/korrigering som upphäver berört startförlopp.",
  "expected": "23-DDQ-PRODAT; BGM=Z04; fält223=Z24; CONTRL och tillämplig APERAK.; Upphäv endast rätt bekräftade/framtida period; vid redan verkställd effekt starta kontrollerad kompensation.",
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
```

## Original reservation

```json
{
  "protocol": "masterplan-reservation-v1",
  "epoch": "gridex-five-agent-20261012",
  "slot": "helper",
  "packet": "a024ccc4-0148-4a8a-9d8d-7284f84a0446",
  "agent": "codex-ediel-z04c-compensation-case-20261013-6f94",
  "branch": "codex/ediel-z04c-compensation-case-20261013-6f94",
  "checkpoint": ".agent-memory/ediel-z04c-compensation-case-20261013-6f94-checkpoint.md",
  "ids": [],
  "files": [
    "__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts"
  ],
  "base": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "createdAt": "2026-10-13T15:27:15.762985+00:00",
  "nextAction": "SOURCE_FINITE_COMPONENT_ONLY: one new AT-Z04C C/Z24 held-compensation consumer assertion file, real inboundProcessing + real source-bound case/warning writer through declared bounded lower SQL/provenance/storage ports. Preserve own object/source/tenant and terminal/CAS/replay, no native effect/final ACK or automatic compensation/activation. New source assertion only; product behavior already exists. Solewriter /root/z06fg_requirements independently GET_MATCH fullreceipt/currentd798/pathabsence before firstwrite. Root writes only unique checkpoint. No occupied runtime/SQL/helper/config/type/frozen/ledger/sharedmemory/GEN/native/backend/original/producer/PR/merge or realcommunication authority. Source handoffs FG6147700001 and Z09FG6148968370 already concrete/paused; previous denied releases/privatepublication/retired/pausedactors preserved.",
  "delegatedWriter": "/root/z06fg_requirements",
  "requirementSupport": [
    "https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6147545538",
    "https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149009842"
  ]
}
```


## Oberoende krav- och källtillämplighet — bevarat original

Rapportens datum/head/antal läses i sin egen källkontext. Aktuell paketbas är d798/e3b6 och ledger323 ovan. Rapporterna är läsande source-/availabilityunderlag; inget körningsoriginal eller whole-IDgodkännande. SHA256 `34b346edbd515fc8e9108df8862d93783f3c0deda9185402692b8889dcdbcb2f`.

<details><summary>ediel-6f94-z03c-z04c-next-literal-applicability.md</summary>

```markdown
# AT-Z03C / AT-Z04C: next literal effect and existing-source applicability

Read-only completed 2026-10-13T15:25:22.791649+00:00. **Z03C is an existing compositional qualification candidate; no new source behavior or full-native L4 chain was established as necessary. Z04C has an actual-caller assertion gap, not an established missing-feature bug.** Do not select a new whole task from absent ID refs. The other root scout is already assessing availability of the narrow C/Z24 held-source case/warning assertion; this report establishes its literal need and bounds only, without claiming it.

## Exact version and bounds

Authenticated actual main `95d8d160491e79b172342654d8dc643346758105`, tree `fa5ab60527a40bd642749365fc275d1d4a69e277`, normal #780 merge with ordered parents `efed3683115c06d1925f8b80c05c801a54db9885`, `2e073477c43c6a133a01710772e65cefc43f6162`. Public #795 is OPEN/unmerged at `894b085ef22b48989375822beb5b483a356d10ed`, tree `99f4168315927d59107606d497b4a2a087f99d12`, sole parent `8e55b5c2d07be78bf666f1eb51b7a551052b6409`, base efed. The older qualified source `3847d59299349cc85f0605da83deedbafdffd440` has tree `d918f63c908c14b60a0d76cfde5b15336ef387b8`, parent `e43728674ed7f21bbe684f431b5b07f282e7d21d`.

Actual-main ledger SHA256 `4a1560a0b16ae37d68aa30c5f67ef616a516c5306e29edf4269b7b1fa9fea850` remains 119 VERIFIED +201 PASSED=320/352, both requested rows NOT_EXECUTED/empty evidence. #800 candidate approval is not credited here. The local checkout is still efed; every current-main claim/pin and actual-main line number below was resolved through `git show 95d8d…`, not the checkout HEAD.

Read AGENTS/current-start/README/current memory/workflow/reservations and relevant prior skill routing. Fresh complete paginated #766 read reached comment6148805180; complete matching-ref snapshot191 refs/55 receipt commits was read. Current public criteria support [6147545538](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6147545538) already records two independent single-card literal reviewers. This report independently checks the actual source/assertion boundaries and current public leaf/SQL applicability; it does not repeat their whole review or impose another approval gate. Only this /tmp report was written. No tests, SQL/proof/native execution, backend/GEN, originals/logs/artifact acquisition, private ROOT3ff/52/successors, CI rerun, source/ledger/shared docs/ref/claim/publication action occurred.

## Frozen cards, verbatim

```json
[
  {
    "id": "AT-Z03C-SUPPLIER",
    "name": "Meddelandefall Z03C",
    "given": "SUPPLIER; Referera rätt originalärende/objekt/kund; L senast4dagar före, LK senast inflyttningsdagen.",
    "when": "Återtag av eget bytes-/flyttärende inom kancelleringsfönstret.",
    "expected": "23-DDQ-PRODAT; BGM=Z03; fält223=Z24; CONTRL, APERAK och enligt förloppet Z04C.; Markera kancellering begärd; inte färdig enbart på SMTP250.",
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
    "id": "AT-Z04C-SUPPLIER",
    "name": "Meddelandefall Z04C",
    "given": "SUPPLIER; Bevara original- och kancelleringsordning; kancellering före original lagras för begränsad korrelation, ingen godtycklig aktivering.",
    "when": "Bekräftelse/korrigering som upphäver berört startförlopp.",
    "expected": "23-DDQ-PRODAT; BGM=Z04; fält223=Z24; CONTRL och tillämplig APERAK.; Upphäv endast rätt bekräftade/framtida period; vid redan verkställd effekt starta kontrollerad kompensation.",
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

## Z03C: existing assertions cover the behavior; qualification is next

| Literal clause | Existing actual assertion/source | Applicable next action |
| --- | --- | --- |
| Own supplier original/customer/object and L/LK calendar | Native acceptance585–618: genuine source, preserved original pointer/LI, foreign decoy, confirmed future period;973–993: prospective actual LK source at zero-day boundary. `scripts/ediel-switch-cancellation-sql-regression.mjs:50–61` calls actual owner RPC for L4 ALLOW/L3 HOLD/LK0 ALLOW/LK-after-day HOLD with explicitly mechanical original/legal/receipt ports. | Bind the existing in-window native members and already qualified calendar component to the exact source. Mechanical source rewriting is never authentic provenance; a new native L4 original is not automatically required by this literal. |
| DDQ/BGM Z03/223 Z24, R/D, legal role/direction | Dedicated flow `prodatSwitchCancellation.ts:15` → source read → exact route assertion → intent/request → gateway `switchCancellationGateway.ts:16` → actual renderer/finalizer/outbox. `ediel-at-z03c-z05c-supplier-profile.test.ts:97–148`, `ediel-switch-cancellation-source.test.ts:27–44,174–182` assert full wire/profile, own fields/customer/point/date/LI, exact source hash/projection, wrong legal route and mutations. | Reuse with limits. Do not reinterpret component source authority as an authentic counterparty exchange. |
| Requested, not completed by SMTP250 | Native acceptance585–618: requested at queue; actual sent status after declared SMTP provider250; physical incoming CONTRL and APERAK each retain requested/completed-null and the original future period. | Existing actual assertion, not a proposed extra test. Sole collector binds reached member output from its already completed original. |
| According to the flow Z04C completes only correct own future start | Same native member receives public physical Z04/Z24, marks exact switch cancelled_before_start and exact existing period cancelled; retains original and permissions/decoy; source replay preserves owned effects. Actual outgoing replies are checked by sendOwnAcks. | Existing actual assertion. Current source-bound result qualification plus literal mapping, rightful tags/row custody and current final carrier reviews/gates remain owner's responsibility. |
| Wrong role/direction/fields/correlation/mutation cannot execute | Protected source SQL preceding calendar checks requires sent-current immutable actual origin, matching switch/customer/point/LI/source hash and current same legal supplier context. Native960–970 covers foreign actor/current role refusal; independent route/source/profile fields cover other prohibitions. Z05C-only negative vectors are not silently credited to Z03C. | Assess the specific reused prohibitions and their source/applicability; no new all-variants native chain inferred merely from NOT_EXECUTED. |

Actual calendar sink: `supabase/migrations/20260930214933_ediel_switch_cancellation_source_origination.sql:26,42–70` → `gridex_switch_cancellations.context_v1`: UTC+1 calendar today, original Z22→start_day−4, Z23→start_day; late date returns exact `source_z03_cancellation_calendar_window`. Upstream sent/current/hash/legal/customer/contract/point/state guards qualify before that date decision. Later original-method and source-customer-masterdata gates remain real, separate requirements; neither a current revoked new-contract premise nor a saved intent/basis bypasses them. Bind INSERT path at :112–140 seals physical original/cancellation provenance and writes only `cancellation_requested`; provider success is not this business completion.

**Smallest Z03C step:** existing sole collector qualifies already completed cancellation acceptance/birth outputs by exact executed source, reached case identities/counts, input/runtime epoch, restoration/cleanup and preserved original provenance, then makes a bounded whole-row/tag/evidence assessment using applicable final reviews/current gates. No code gap requiring a new Z03C source packet was established.

## Z04C: exact missing assertion boundary

1. **Normal order / right future period / ACKs:** reuse native585–618 above and actual protected lower C dispatcher. `20260930161624_ediel_supply_market_source_lifecycle.sql:119–143` matches sealed actually sent Z03, reversed legal parties, physical point/LI/customer/start, selected own switch, and only its confirmed future period. Ambiguity, wrong source and active/executed period do not produce an effect; partial-source SQL146–154 also checks scoped future cancellation and wrong identity namespace. This is concrete existing source/effect support.
2. **Cancellation before original:** native birth58–109 genuinely captures immutable Z04/Z24 through public mailbox/parse/catalog/source/reception, preserves admission clocks/originals/replay and zero graph/effects with no original. It does **not** call cancellation processing or later original correlation. Therefore its birth success cannot alone be labelled the whole bounded arrival-order/no arbitrary activation criterion. Existing consumer/SQL source refuses unavailable exact original and normal start checks cancellation source decisions, but an already qualified complete arrival-order witness was not identified in these public assertions. Keep this as whole-proof unqualified; do not automatically create a duplicate native chain before sole owner checks available prior outputs/components.
3. **Executed effect starts controlled compensation:** `__tests__/ediel-at-z04c-supplier-acceptance.test.ts:56–66` mocks the RPC reason and calls Legacy; it asserts manual-review semantics/event/workflow and no application mutation. It does not execute the actual inbound coordinator's source-case path, durable correct-source/object/period warning or an operator start. A mocked missing/terminal workflow is therefore not a product absence diagnosis.

Actual current-main path for (3): `inboundProcessing.ts:1313` → `applySupplyMarketSource` → actual public SQL wrapper → unchanged lower C dispatcher → held own partition with `z04c_effect_already_executed_compensation_required`; the coordinator finishes its real source owner, skips `fullyApplied` ancillary effects (:1343), **still creates source-bound `ediel_inbound_cases` (:1351)** and writes **durable validated warning (:1355)** with `inboundCaseId`, `reviewRequired`, `fullyApplied`, held `sourceObjectPartition`, zero `committedEffectReceiptIds`, `applied`/`idempotent` (:1357–1359). This does not depend on a customer-application workflow. `inboundCases.ts:392–430` parses physical source, validates register shape, keys the pending_review record to the source/tenant and preserves own parsed customer/point/start; :455–480 retains already manually decided state using status comparison/re-read.

The register-structure exception is narrowly caught only for a canonical application-rejected source. For intact C/Z24 with accepted syntax/full application the real case writer is reached; a generic rejected/syntax/manual snapshot would not establish this compensation path. SQL guards first prevent arbitrary source/scope/graph selection, and the executed-effect refusal cannot become automatic restoration or activation.

`__tests__/ediel-inbound-own-source-coordinator.test.ts:273–283` already probes actual coordinator mixed supply and a modeled case callback; its :307–311 all-held probe checks no final ACK but **does not assert C/Z24 compensation cause, exact case call and source-bound warning**. Its catalog fixture selects Z04L, not C. These are useful harness components, not the missing C criterion.

**One concrete bounded SOURCE-assertion candidate:** a finite actual `processInboundEdielMessage` C/Z24 held-compensation control using the existing declared port style, truthful actual canonical grammar/application and a properly shaped cause-bound held partition, asserting unchanged own/foreign source/business graph, exact actor/company/source/object/original/period review call and warning/case linkage, no effect/positive final response, manual decision/replay preservation, and missing/terminal-workflow contrast. Treat declared persistence ports as modeled; it is not native/durable whole-card proof. The other scout is checking this component's task/file availability; **no free whole-ID/component or new writer is claimed here**. If existing owner-held qualified evidence already supplies this exact caller witness, use that evidence instead. A bounded review/operator-start may satisfy “starta kontrollerad kompensation”; neither automatic completed restoration nor a new public approval API/LIVE action is added to the frozen wording.

## Independently checked applicability pins

The 19 listed cancellation/source/helper/component/lock paths other than the whole inbound caller and schema are Git-blob identical actualmain/public795. Of these, the native test/config, birth test/config, normal/mail/prospective helpers, source/gateway/route, profile/legacy/adapter, rule regression and lock are also exact old3847. `inboundCases.ts` differs old3847, so its changed source/case predicates need actual resulting-source qualification; it is exact main95d/public795. This is a selected source boundary comparison, not equality of all transitive runtime/catalog inputs or executed native outputs.

| Main95d path | SHA256 | Main95d vs public795894 |
| --- | --- | --- |
| `scripts/ediel-cancellation-public-acceptance-native.test.ts` | `dd48b2e188c7b2e9cdee90f0f4230fedc3c234ad326c8093458cfbddb8dc6b86` | EXACT public795 |
| `scripts/ediel-cancellation-public-acceptance-native.config.ts` | `c1e8e88b42659c4faa348509fd13c0886943baa794799a7b4a882a8959e58f91` | EXACT public795 |
| `scripts/ediel-cancellation-public-birth-native.test.ts` | `3c26675673e22c6e66e476884dfc01631747cb12ba8d5e728b5795a0f782b397` | EXACT public795 |
| `scripts/ediel-cancellation-public-birth-native.config.ts` | `99517d3f2c0d39d2723d5effd4890ee56798d6a419c7580186a1a7e440c8afbc` | EXACT public795 |
| `scripts/helpers/ediel-normal-switch-native-fixture.ts` | `b03ed608fe49648281b11bbd8a83e09673a7aa6a08f51a4e661d38a58e826cdc` | EXACT public795 |
| `scripts/helpers/ediel-cancellation-prospective-source-2ea.ts` | `e3aee9298622400beadb614447377ddaa792e5ca1cf4c0477907610e8473cd56` | EXACT public795 |
| `scripts/helpers/originalMailboxNative.ts` | `5b07084d10ab7833bfbf1e21d05c774761d721f2980429079682fef3923462fa` | EXACT public795 |
| `__tests__/ediel-at-z03c-z05c-supplier-profile.test.ts` | `011cca4fd827b8ae2b4a414d93f363ce66b7ee484dc18ad5438df5ca22dce7cc` | EXACT public795 |
| `__tests__/ediel-at-z04c-supplier-acceptance.test.ts` | `866df8e9b1a0c9083d470f8818d4e97cbc816f4c0f8601bfba3b771e2a11482c` | EXACT public795 |
| `scripts/ediel-switch-cancellation-sql-regression.mjs` | `ae817c40ec9d915c85fb65326c5dae0443b705b5c23632e442d023f48dac240e` | EXACT public795 |
| `lib/ediel/flows/prodatSwitchCancellation.ts` | `976fc83b17b7e9fe6d9387675d450620b8ff9fe4c779686c6a146236fe5cee81` | EXACT public795 |
| `lib/ediel/intent/switchCancellationGateway.ts` | `43df4ec0f23221b895d6836a4979b1e05fd7eaa40d5d058b30dfef8b6ca3cb3a` | EXACT public795 |
| `lib/ediel/production/switchCancellationSource.ts` | `ecba3bfaa1fbfc177c581c6ede413c7eacc5f1ebc6c08342a49f6791b3900fd5` | EXACT public795 |
| `lib/inbound-mail/cancellationBirthProfile.ts` | `656b0ffd086bfa4d21f3ba84bcccaa7a79eeb9f5ad00f11479a5899cd3335116` | EXACT public795 |
| `lib/inbound-mail/inboundStatusUpdater.ts` | `3d582e8bff449bf657ec84574ddf5fcccf19a6b291f9923ab2a01d7f29154196` | EXACT public795 |
| `lib/ediel/flows/inboundProcessing.ts` | `e617ce5f322e220b8fec7448fc2e9faec33710be6cdb65b86d8a5f763d283e4f` | DIFFERENT public795; Z02-only caller addition |
| `lib/ediel/flows/supplyMarketTransition.ts` | `584e51953ca5da03ad9d216ce8e0e88cc09720b5dd1e7e8f6bcc7e4ec5995829` | EXACT public795 |
| `lib/ediel/flows/inboundBusinessStateMachineLegacy.ts` | `7d85d56cbec1cf344d22412721691dacff49a1a02fbe11fa6d357c23d8180962` | EXACT public795 |
| `lib/ediel/inboundCases.ts` | `39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f` | EXACT public795 |
| `package-lock.json` | `8bf0aca13c2f57d92db355bda81f38e526b3bd50a33db7859d272daad8d9f5c5` | EXACT public795 |
| `supabase/schema.sql` | `0a9a8e147f94a03c62870a39e363a60567e22fa6e91196ccef6b41795372c559` | DIFFERENT public795; Z05-only top wrapper extension |

The actual main caller has a C1 Z02-only retained-response helper and guarded early return; the C held-case/warning excerpt is byte-identical public795. Independently extracted exact CREATE FUNCTION definition hashes (including dumped signature/language/body; not just a function name) are equal main95d/public795:

| Actual SQL definition | SHA256 |
| --- | --- |
| gridex_switch_cancellations.context_v1 |535bbd5fd637bd4d56ed13dd011af24f8a3e1fda50676d5992d8efe08276f670|
| public.ediel_switch_cancellation_source_v1 |ab035e94f5fc5864b09aec6377b0aacd7585e8f7d1fb8057f2c2dcc6244ce02b|
| public.ediel_reserve_switch_cancellation_v1 |ebbc221389fc85803e13fca5aaea94cdfc0d84659c905b07994878b5a40ff1d5|
| public.ediel_require_switch_cancellation_source_current_v1 |aa835adbd74cc83e8f585fdd7e6333cd6fb22983ccae18125f83fbdceae5d7ce|
| public.ediel_prepare_customer_masterdata_v1 |0d4b39feb6db22be7cd4361bdbc9bb2a976f4ab7870170b6132ce73fa75c5ff4|
| gridex_supply_rescission.apply_supply_before_rescission_v1 |d327bb8b1c38dbce16defbc95dbd0c3c0579dce959f5aad49227af649c955f32|

Top `public.ediel_apply_supply_source_v1` differs: main hash2acf6f9ffecacea213045697aa289c50a46766343289cba83cb26bb4a0712c73/public hashd3713531e1a95c97647bc4f9846602b196e068d712517c285729f1a1264e5c27. Its extension is selected only for incoming Z05 and recorded Z08 end scope; Z04 bypasses that condition and reaches the byte-identical lower entry. Full schema, migration/input/catalog maps still differ. This is a conditional static Z04 applicability observation, never current runtime or full source equivalence.

## Public evidence, metadata and ownership

Existing public in-repo `quality/audits/ediel-masterplan-v2/z05c-ce01569a4b/contract-proof.json` reports old3847 original38137625048/a1/job114464649346 with31/31, errors/skips0, archive hash2f1c496436924cebc1cb8abb96ebab789bd0738c1d90de067ed0b24f64b6e925, full9834 source attribution. It deliberately restricts whole ID to Z05C; the other three case identities remain source-bound component candidates. Existing historical failures and source qualification are not overwritten; no archive/log was opened or reacquired here. Closed merged #756 head339a8b7ddbe1d784123873511bbf0182ffe7b19a/merge2715e7ea5ca92d635b6fcdf1a7162c286559070f carried that bounded work. Its earlier reviews of bc15/50be do not approve a new version or these two whole cards.

Current #795 metadata records `cancellation-public-acceptance-native`38403471351/job115316828488 and `cancellation-birth-native`38403471288/job115316827521 SUCCESS at894b; #780 records acceptance38392686577/job115280099789 and birth38392686626/job115280100036 SUCCESS at2e073. They are **metadata only**, no actual case/count/source/runtime contents inferred. Current #795 has42 checks,30SUCCESS/11ordinarySKIP/one Z05FAIL per current board; unrelated failed native or stockH output cannot serve as a cancellation original. No rerun is requested.

Custody remains receipt-bound: slotC1 b971ef0c…, current C1/native63ddb…; slotC3/current runtime2255742ce5a41aa5968ace2d99baec3dcf40defd owns `inboundProcessing.ts`/runtimeDecision; GEN/source slotce80cdd3… and producer3193ac7d0bd3401d2cb6b276c7d973da487a19f3; SC0377b422… and associated occupied TS consumers are unchanged. Fresh full resource/receipt reading did not provide an independent cancellation whole-task handoff; absence of whole-ID or producer refs is not scope clearance and does not replace the parent's existing sole-collector routing. Latest [6148282983](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6148282983) and [6148342225](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6148342225) explicitly retain root GEN/native/serial and occupied consumer assignments.

**Blocker / next:** Z03C needs current exact existing-original/output qualification by the existing collector, then literal whole-row decision; Z04C needs a verified applicable caller/operator-start witness and bounded arrival-order assessment. Root may route the one genuinely missing finite caller assertion only after its other scout's explicit whole-task/file availability check and bounded receipt handoff. This reviewer is paused; no claims, tests, native/GEN/source publication, private source inspection or approval credit are authorized by this report.
```

</details>


## Oberoende aktualiserad availability — bevarat original

Rapportens datum/head/antal läses i sin egen källkontext. Aktuell paketbas är d798/e3b6 och ledger323 ovan. Rapporterna är läsande source-/availabilityunderlag; inget körningsoriginal eller whole-IDgodkännande. SHA256 `a83374509b92ada6ecf7d65d665b3a3a4cba56147082bb66ab74a1af087df249`.

<details><summary>ediel-6f94-next-after-z09fg-availability.md</summary>

```markdown
# Nästa steg efter Z09F/G — begränsad aktuell source availability

**Beslut: QUALIFIED_BOUNDED_SOURCE_CANDIDATE för exakt EN ny finite testkomponent: `__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts`.** Saknad assertion: den verkliga C/Z24 own-source callern → den verkliga beständiga inbound-case writern → beständig validated-warning när lower SQL-porten lämnar ett eget objekt held med `z04c_effect_already_executed_compensation_required`. Befintliga tester delar denna komposition med mocks. Skydden finns redan i produkten; detta är inte en bekräftad featurebug eller hela AT-Z04C-proof.

Detta beslut dokumenterar scoutens **daterade preclaim-clearance**, inte att filen fortfarande är fri vid stängning. Scouten utförde ingen claim eller sourcewrite. Efter public Z09FGhandoff och egen färsk slutkontroll har root enligt separat nedan angivet kvitto nu claimat den enda filen. Eligibility följer användarens uttryckliga tillstånd att ta verifierat ledigt arbete; silence, obesvarad handoff och IDref-frånvaro används inte som tillstånd. Den tidigare konkreta Z01watch/physicalACK-kandidaten är occupied e435 och väljs inte under annat filnamn.

## Faktisk main, krav och latest scopes

Slutlig autentiserad snapshot **2026-10-13T15:24:21Z**: main **d798eb36f35cd4f437d44c8d234b4dbb81adc7a6**, tree **e3b6c11677a2b871a128504f1616def7d22dba1e**, ordnade parents **95d8d160491e79b172342654d8dc643346758105**, **fba453cc7cc9de8a26ec75d29248e1733316fcd1**. #800 är CLOSED/MERGED vid15:19:56Z. Ledger nu **119 VERIFIED + 204 PASSED = 323/352**, SHA256 **7266ee57be5ac633ec0e8ca3f169aaf7d048da45ca0abfc6004284eae75c822e**. AT-Z03C/Z04C är fortfarande NOT_EXECUTED med tom evidence. AT-Z05C är PASSED och väljs inte.

Inledande scout hade95d/fa5/320. Slutlig sourcecurrentness är bunden till d798; de nedan namngivna runtime/case/adapter/testblobs är samma på båda baserna. #800 levererade sin fyrfiliga metadata/three-rowcarrier. Lokal `/workspace/gridex-ops-platform` checkout är äldre efed och förblev ren; ändrad runtime lästes från faktisk public main, inte gamla lokala rader.

Full #766 paginerad från reset till **776 kommentarer genom6148968370**. Färska **192 live refs/56 kompletta receiptJSON**, alla GET lyckade; refsetSHA256 **856b85e7d385090b9be0149cf2a996a0f6bfae5f1553bdc188753a86977bfb66**. Full payloads kontrollerades för files, directory/glob, namngivet whole-task/prepared assertionarbete, IDs, slot och producer. Ingen live cancellation/C03/C04/newconsumerreceipt eller covering directory/globscope hittades. Den enda precisa postreset C03/C04-remark är completed READ_ONLY support [6147545538](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6147545538), inte ett writeclaim/prepared samma-criterion writerpaket.

Latest [6148968370](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6148968370) är Z09FG exact-two publicsourcehandoff **76a6114f14620c04ea5c3cc72733eaec4f13609d** med writer/root PAUSED under db3d. Dess Z04C-next är uttryckligen read-only actualcaller/case/warning availability, inte ett C04writeclaim. FG3f4 och Z09FGdb3d är kvar; inga dependencyfiler återclaimas.

## Exakt ny resurs och begränsad frihet

| Kontroll | Resultat |
| --- | --- |
| Proposed path | `__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts` |
| UTF8POSIXpath-SHA256 utan newline | `d3f2acb77bb1d7a3c265a2a1bb5fd8b4e24e89effed813b956b22aa1bae4ae34` |
| Exact ref | `refs/tags/agent-claims/masterplan/file-d3f2acb77bb1d7a3c265a2a1bb5fd8b4e24e89effed813b956b22aa1bae4ae34` → HTTP404 |
| Actual d798 contents | HTTP404, filen saknas |
| Current open PR fullpaths | Samtliga637paths/5PRs utesluter filen |
| Full current receipts + latest explicit handoffs | Ingen same-criterion writer/preparedtask/directory scope |
| Relevant closed cancellation/source PR fullpaths | Ingen exactnewpath eller prepared same-criterion consumerfil |
| AT-Z03C/AT-Z04C/producer-cancellation exactrefs | HTTP404, stödjande inventory och inte ensam clearance |

Det finns både ett konkret nytt behaviororacle och en verifierad exactnewresource utan överlappande namngivet uppdrag. Ett nytt packet kan därför avgränsas **helper/idsEMPTY/filesONLY denna enda fil**, unik owncheckpoint, actual dåvarande main/base/tree och finite-nextAction. Inget wholecard/slotC/producer/sharedmemory/publication/SQL/backend/GEN/native/cancel-first-ägarskap ingår. Ingen ny config eller adapter behövs: befintlig `vitest.config.ts` väljer `__tests__/**/*.test.ts`, Nodeenvironment och unitsetup. Unitsetup deklarerar placeholderclients och startar ingen backend. Read-only imports av befintliga fixtures är tillräckliga.

Samtidig aktiv runtimecustody ligger kvar, vilket refuterar globalfrihet:

```json
{"receipt":"ec78b88f378462a6f016ed38bc1f8977bfb485b9","protocol":"masterplan-reservation-v1","epoch":"gridex-five-agent-20261012","slot":"C1","packet":"c8f8aeee-087c-4d49-9d4b-a51aa750911d","agent":"codex-five-agent-C1-b7e2fae0","branch":"codex/five-C1-z02-v5-b7e2fae0","checkpoint":".agent-memory/masterplan-five-C1-native-b7e2fae0-checkpoint.md","ids":[],"files":["lib/ediel/flows/inboundProcessing.ts","__tests__/ediel-z02-terminal-protocol-replay.test.ts",".agent-memory/c1-terminal-replay-fix-20261013-checkpoint.md"],"base":"c007337f117dde5c6719e9d96bc76f00b118bbe6","source":"591803665f7fa207017e43a9ced30e5be0f757e3","nextAction":"Import exact three terminal-replay postimages, combine already integrated worker-company repair and applicable soleGEN output, prepare exact fullV5 workflow/newproducer/two finalnoncoauthor peers/one genuine113 and latest mandatory gates. Preserve source original113 negatives/currentmain316/noactivation/publicHTTP/API794tenant scope."}
```

```json
{"receipt":"051ec7e48eb08c14a5a50f6faedc356a99e764d9","protocol":"masterplan-reservation-v1","epoch":"gridex-five-agent-20261012","slot":"C1","packet":"957de313-41e7-4077-a688-1f69da186897","agent":"codex-five-agent-C1-b7e2fae0","branch":"codex/five-C1-takeover-786-b7e2fae0","checkpoint":".agent-memory/masterplan-five-C1-native-b7e2fae0-checkpoint.md","ids":[],"files":["lib/ediel/matching/postgrestFilter.ts","lib/ediel/matching/processMatcher.ts","lib/ediel/inboundCases.ts","lib/ediel/intent/dispatchState.ts","lib/ediel/testing/testRunTransportMetadata.ts","__tests__/ediel-postgrest-filter-followups.test.ts","__tests__/ediel-recipient-preparation.test.ts"],"base":"f36dbba1b8c09e0c6e54e027db05d94b171f2058","nextAction":"Prospective user-authorized idle helper786 source takeover: preserve reviewed existing source; exact custody and final-head gates before root serial delivery. No new code/native/GEN."}
```

Caller resource **file-fbc9a5f963bc4fa163e0a5c9b99d88468f58d1a2d1937d780fb990f5ad3da727** GET_MATCH ec78; casewriter **file-c56aba1fc5acdd5ff34a6ecdf657ec3801c0a0120cc770d126968d8f3227b203** GET_MATCH051ec. Dessa filer får endast läsas. Rootfulltransfer [6132656380](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6132656380) gäller CURRENTLY OPEN EdielPRs och deras lanes; den nya consumerfilen träder inte in i någon currentPRscope. Historiska cancellationowners återuppväcks inte.

## Literal krav, verklig caller och refuterade protections

Frozen `acceptance_tests.json:2920`, AT-Z04C:

> Bevara original- och kancelleringsordning; kancellering före original lagras för begränsad korrelation, ingen godtycklig aktivering.
> 23-DDQ-PRODAT; BGM=Z04; fält223=Z24; CONTRL och tillämplig APERAK.; Upphäv endast rätt bekräftade/framtida period; vid redan verkställd effekt starta kontrollerad kompensation.

Den nya filen avser endast controlled-start consumergränsen. Den uppfinner inte automatisk verklig restoration, externt utskick, färdig kompensation eller approvalAPI.

Full actual main effecttrace:

1. `lib/ediel/flows/inboundProcessing.ts:1304` tar canonical own domainobjectbranch; `:1312–1319` kallar verklig `applySupplyMarketSource` för Z04/Z05. Testets korrekta C/Z24 positiveadmission måste faktiskt nå denna port; en tidig legal/HOLD är inte consumerbevis.
2. `lib/ediel/flows/supplyMarketTransition.ts:50–75` skickar bara company/source/actor till `ediel_apply_supply_source_v1`, validerar full ownpartition och consistentcommits/receipts, beräknar applied/fullyApplied/reviewRequired. Held compensationobject har inget effectreceipt. Lower SQL/provenance/original-period-porten deklareras i finiteprovet; native/legal/PGproof påstås inte.
3. Caller `:1322–1330` projicerar bara faktiska commits/effectreceipts; `:1338–1339` kräver applied för committed-domainACK; `:1343–1348` kräver fullyApplied+singleownobject för Legacy ancillary. HeldC får därför ingen slutlig positiv businessACK, switch/periodactivation, Legacy projection eller provider/outbox. Oberoende teknisk syntaxCONTRL ska inte felaktigt förbjudas.
4. `:1351–1354` kallar verklig `createOrUpdateInboundProdatCase` även utan supplycommit. Endast registerstructure-invalid + redan nationalrejected kan bli nullcase. `:1355–1359` persisterar validated-warning med **inboundCaseId, sourceObjectPartition, reviewRequired, applied/fullyApplied/idempotent och committedreceiptlist**. Den egna partitionen innehåller compensation-heldreason.
5. `lib/ediel/inboundCases.ts:392–430` använder fysisk rawsource/registerstruktur och verklig parser, inte attackerad parsed_payload. `parseInboundProdatBusinessData:146–299` håller C/Z24/objects/rawfält; masterdata matching `:307–379` är companyscoped och multipart väljer inte firsttarget.
6. Actualcasewriter `:432–536` persistar company/source/pending-review + warning. Companymismatch vägras; terminal applied/approved/rejected och objectApplication-review bevaras `:453–455`. Update har scope/CAS `:459–466`; lost-CAS reread måste ha samma case/source/company och full intendedpayload eller terminalreview `:470–483`. Uniqueinsertwinner måste matcha source/tenant `:498–514`.

Detta refuterar påståendet att kontrollerad compensation-start helt saknas: source-bound durable case/warning finns redan. Newtest kräver ingen runtimekorrektion eller extra juridisk/providerapproval; den assertar kompositionen utan att byta ut dess två målsinks.

## Exakt missing assertion och möjliga verificationlimits

`__tests__/ediel-at-z04c-supplier-acceptance.test.ts:56–66` mockar RPCscalarreason och Legacyworkflow; storage förbjuds. `__tests__/ediel-inbound-own-source-coordinator.test.ts:52` mockar hela casewriter till declared-case; `:80`/`:172–177` använder Z04L/Z22; heldprobe `:306–309` assertar ingen positiveeffectreceipt, inte actual Ccasepersistence. Generiska realcase CAS/foreign/terminal controls i `ediel-inbound-case-concurrent-insert.test.ts:47–124` och register/unresolved-case tests är separata. Ingen current compensation-specific actualcaller→actualcasewriterkomposition hittades. Futureperiod-cancellationnative är inte alreadyexecuted-compensation-proof.

Den enda nya filens oracle: korrekt canonical C/Z24 ownsource når exakt own RPC; declared all-held compensationpartition blir en faktiskt persisterad own pendingcase + case-linked validated-warning med exact own physicalobject/heldreason; tom effectreceiptlist och ingen businessactivation/Legacy/provider/outbox/finalpositivebusinessACK. Sammasource replay använder samma case och bevarar manual/terminal/objectApplicationdecision. En foreignwinner eller relevant changed-CAS ska vägras på rätt lager och bevara history. Missing/terminal customerapplicationworkflow får inte göra durable startcase försvinnande. Detta beskriver startgränsen, inte finishedcompensation.

Finite lower SQL/provenance/SDKstorage/clock är deklarerade ports. Actualcanonical/supplyconsumer och actualcasewriter måste köras; mock av någon av dem återintroducerar befintlig lucka. Authenticarchive/goTrue/RLS/PGlocks/originalcorrelation/physicalACK/nativepersistens behöver separata faktiskt kvalificerade underlag hos befintlig owner, utan ny extra blanketgate. Ingen RED/GREEN/körning finns från scouten. Om implementationen kräver sharedruntime/helper/SQL/configändring eller visar featuredefekt routas det till befintlig ägare; den nya filcustodyn ger inte sådana writes.

## C03 återanvändning och C04 andra wholegräns

Completed support [6147545538](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6147545538) ger AT-Z03C en **compositionalapprovalcandidate**, inte nytt implementationkrav. Existing `scripts/ediel-cancellation-public-acceptance-native.test.ts:585–618` går ownoriginal/customer/object → queued cancellation_requested → provider250 → physicalCONTRL/APERAK ännu requested → endast causal Z04/Z24 cancellerar own futureperiod, bevarar original/permission/foreignscope. `:973–993` når faktisk LK0 source/queue. Calendar ownerRPC `scripts/ediel-switch-cancellation-sql-regression.mjs:50–61` täcker L4ALLOW/L3HOLD/LK0ALLOW/LK-after-dayHOLD med declaredmechanicaloriginals; loaded/currentkernel SHA256 **1f041faf63d17a88edbb481a3def8476178b3e9857bbf9843e26508cb34be275** source-applicable enligt avslutad support. Mechanicaloriginals är inte authenticnativeprovenance.

Nästa03Coutput hos solecollector/root: kvalificera redan utförda exactoriginals/reachedidentities/counts/input/restoration/cleanup och bedöm hela kortet med applicablefinalpeers. MetadataSUCCESS för acceptance38403471351/job115316828488 och birth38403471288/job115316827521 är inte contents. Ingen ny fullhistoricalL4nativeproducer krävs bara för att nativeheader är ärlig om limit. Denna scout hämtade inga originals/logs/artifacts.

C04whole behöver dessutom cancel-first→bounded correctoriginalcorrelation/order/custody/noarbitraryactivation. Birth `scripts/ediel-cancellation-public-birth-native.test.ts:58–109` visar firstreception/replay/zeroeffects föreoriginal, inte actual cancellationprocessing/senareoriginal. Den nya finiteconsumerfilen löser inte detta och tar inte entireC04/native/produceruppdraget.

## Full current PR-pathsets och relevanta closed donors

Samtliga current fullfilespages lästes, inklusive #799 publicdrift. Bara #776 överlappar direkt callerdependency som är read-only och behåller sin befintliga H/runtimecustody.

| Current open | Head | Base | Fullpaths |
| --- | --- | --- | --- |
| #799 | 4ed465f87f08bba21e0011962ab7fb924cd245aa | 95d8d160491e79b172342654d8dc643346758105 | 282 |
| #795 | 894b085ef22b48989375822beb5b483a356d10ed | efed3683115c06d1925f8b80c05c801a54db9885 | 37 |
| #794 | 9f008c314b6a283138cbc91ec376f4f9306587ce | 51f5fa5e80c42350d697bfed42520672749d4467 | 290 |
| #790 | bed533a27fac07662e2e59ae2bc965bc84898b2a | 69e50f4f0f8267dcdf4fe8414dac75ac1ab3e07a | 14 |
| #776 | 99b10d2d735daab556ed0b03df3f9ba3466b5c19 | 35ad0e6d9fd2e100d22bf5c27cd1958f77063e3c | 14 |

None contains newconsumerpath. #799/#795/#794/#790 have no cancellation/case/coordinator/readingfixturepath; #776 contains only `lib/ediel/flows/inboundProcessing.ts` from that closure. #799title/body is current customerflow/admin consistency, not prepared C04consumerassignment. #794 broad API/SQLscope remains existingowner's; no SQLchange is proposed. #795 only publicmetadata/pathsets read; private preparedsource/outputs remain unread.

Fullrecentclosed: #800mergedfba/95d/4; #756merged **339a8b7ddbe1d784123873511bbf0182ffe7b19a**/11, birth/intake/nativeAT05C; #627closedUNMERGED **ac26467f2285a0f6c738e8ebbfbc55a495363272**/5, old cancellationworkflow/native/config; #676closedUNMERGED **1b4be1fb5b78a6ef357f16b304f112ad939ab6ed**/13, old original/publicacceptance workflows/config/native, queue/source tests, renderer/source, SQLcalendar and20261007132500. Neither is a currentpreparedconsumerwriter. Full#780/43,771/9,760/13,752/5,758/5,768/11 also exclude newpath; C1/Hcallerhistory isn't freshwritecustody.

Z01candidate was refuted by e435/CLAIM6148567034, sole `/root/remaining_contracts`, exacttwo native sourcefiles for watch/physicalCONTRL/nonactivation/fieldrefusal, files9573/c3d1MATCH. Alternativefilename gives no clearance. Existing-data finiteproof c7ec/file17a0 now PAUSED/public **d5ff0b76cdabf0c669500e8b64b4ea8a112c630b**, READY6148907021. FG/BRP/ESCO/SC037/SC039/SC046/DB05/H known writers/collectors/GENrouting remain unchanged. This scout neither restarts them nor claims all29remainingcards are external.

## Source-applicability hashes

All these actual d798 bytes match earlier95d:

| Source | Gitblob | SHA256 |
| --- | --- | --- |
| frozen acceptance_tests.json | 3717ce88daaf98c916bb996edc6fe7887bf65b6c | e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10 |
| inboundProcessing.ts | 86242cab00519ced855d900a37329074d587be51 | e617ce5f322e220b8fec7448fc2e9faec33710be6cdb65b86d8a5f763d283e4f |
| inboundCases.ts | c08e51d67c98b8b7be0fc726f2509059cf4aaec0 | 39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f |
| supplyMarketTransition.ts | 12eb1c04e2af1caf1c539107f2a948c034dba346 | 584e51953ca5da03ad9d216ce8e0e88cc09720b5dd1e7e8f6bcc7e4ec5995829 |
| modeledAT04Ctest | 4236a0fd6f15f8e3782312157c6ca283ef960f95 | 866df8e9b1a0c9083d470f8818d4e97cbc816f4c0f8601bfba3b771e2a11482c |
| owncoordinatortest | 0744d760efb9bac947341540fdc8d974a9c40754 | 7571f106da4d58c5574da43a905aa79b644c4f49fa4b4e3f8494cc75faa6659f |
| prodatOwnSourceReadingFixture.ts | be1ce92c6f735c841dda6941f71d936691ae2915 | ff0353dc388465fb901ed9b9bb475ed9d5bafc4ecbbd392ee241a4963ea1f327 |
| prodatOwnSourceReadingAdapter.ts | 287cf87dd4c626dd29bf7ea7e439883bd6680b40 | fc4d5d8cd7f6a7398e6d498a092280dca1d9a1b4e4bdc3fd33ad8dce333c18ed |
| realcaseconcurrenttest | b39f98f81f08d001328e72eec0fa994131a01e19 | 5ef751e31de031758224b87c7e0e1b2f78646243e3e01724bfd701540c23ff27 |

## Separat postclaimstatus från root, inte en scoutoperation

Efter publicZ09FGhandoff6148968370 och independentlyverified main323/correction6149009842 gjorde root en ny latest766/custodykontroll, inklusive ROOTdelivery6149004435 och ingen Cclaim. Root meddelade därefter performed receipt **359d27a100e3f5de4992e5abd921060c85988ae4**, base **d798eb36f35cd4f437d44c8d234b4dbb81adc7a6**, tree **e3b6c11677a2b871a128504f1616def7d22dba1e**, **endast** den här rapportens newconsumerfile/resource, CREATE_IF_ABSENT + GET_MATCH/fullJSONmatch och [CLAIM6149092334](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149092334). Root PAUSAR den nya testfilen; sole writer **z06fg** har fått uppdraget och ska själv verifiera GET_MATCH före första write. Detta är parentens explicit separat utförda acquisitionreceipt; scouten hämtade/ändrade/claimade inte den operationen och gjorde inga fler oförändrade availabilitychecks.

Vid rapportstängning är den nya filen således **upptagen av vårt bounded rootpacket**, inte globalt fri. Finiteexecution och två oberoende sourcepeers ska därefter kvalificera faktisk ny version. Fullcard/native/GEN/output/currentCI/serialmerge stannar i befintliga lanes; denna onefilecustody överför inget sådant. Senare sourceguard/mainändring ska bindas till faktisk testad version.

Skillrouting: tidigare aktuella read-only review/spec/fp-skills och managedruntime; Supabase-skill lästes för declaredSDK/native/SQL/RLSgränsen. Inga Supabaseimplementationer/schemaändringar gjordes. Ingen source/test/fixture/config/checkpoint/sharedmemory/ref/producer/PR/publish/native/backend/GEN/capture/original/log/artifact/CIrerunmutation eller provkörning här. Endast denna `/tmp`-rapport skrevs. Tidigare avslag, retainedrefs, privata preparedsources, retiredwriters och #310PAUSED bevaras.
```

</details>


## Skrivarens första självständiga readback och plan

Solewriter bekräftade före första write att hela public receipt359d JSON/tree/enda parentd798, exactfile GET_MATCH, source/tree/branch och absentpath stämmer, och läste CLAIM6149092334. Root har godtagit en-fils-planen: faktiskt counted C/Z24-wire, verklig resolveCanonicalRuntimeDecisionWithRegistry, processInboundEdielMessage, applySupplyMarketSource-decoder, createOrUpdateInboundProdatCase och createEdielMessageEvent; slutna deklarerade lägre source/catalog/SQL/storageportar. Verkliga casewriterreturn får inte ersättas med ett önskat stubresultat. Den finita tabellporten ska hantera faktiska company/source/status/time-CAS och registrera alla reads/writes.

Testmålet är precis sourcebunden pending-reviewcase med eget kund/punkt/LI/startcontext och varning med caseId/ownpartition/compensationheldcause, bevarad rawsource och egen/främmande affärsgraf, inga nativeeffekter/finaldomainACK/aktiveringar, replay och redan applied/approved/rejected/objectApplication-state samt CASförlust till terminalt beslut och felaktig/foreignscope som precisa faults. Lower SQL/sourceauthority är deklarerat modellerad; inget verkligt DB-/native-/operatörsslutförandebevis påstås. Root rör inte testfilen.


## Fryst source och faktisk finit verifiering

Skrivaren är pausad vid `e627eb13d09bbdaa8e7850be9113f371e18184f6`, tree `855ca9157f3ba9a5e9ab80219d6b88ed2b6d4ae0`, enda parent/sourcebas `d798eb36f35cd4f437d44c8d234b4dbb81adc7a6`/tree `e3b6c11677a2b871a128504f1616def7d22dba1e`. Enda sourceändringen är ADD av den reserverade 202-raders testfilen, SHA256 `1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2`, blob `3870580e726a56d01367fa6dd19730621e0d63da`, mode100644. Root har verifierat dessa värden och samtliga tio oförändrade beroendehashar mot source/workspace. Root checkpoint var inte ändrat eller committat av helper.

**Första slutligt gröna körningen: 10/10 PASS, 0 FAIL, 0 SKIP, exit0, Node22.23.3/Vitest4.1.9.** Exakt slutfil ESLint PASS utan varningsoutput, focused strict TypeScript PASS och staged diffcheck PASS. Typecontroller ärver befintlig tsconfig.tests och ändrar bara incremental:false/include till nya testfilen; inga compiler-/produktgates försvagas. Ingen grön körning upprepades för att skapa logg. Slutlig finit stdout SHA256 `255f4a00b1e1e272a8b702e4c7d96eae82d981a8419518f0d32baba12c48f936`, stderr tomt/e3b0. Alla råa stdout/stderr från första försök och slutresultat, controllers och första scaffoldsource är sparade och hashkontrollerade; de bevaras nedan.

Den verkliga koordinatorn och fulla fysiska/canonical sourcepolicy, actual own-source READ-dekodering, supply-resultdekoder, riktiga caseparser/CAS/reread och riktiga db-eventwriter exekverades. Lägre tenant/catalog/source-SDK/SQL- och tabellportar är modellerade. Detta är därför ett verifierat finit callerkomponentprov, inte verklig PostgreSQL-durabilitet/RLS/unikindex/nativeauktoritet eller hela kompensationsförloppet. Unreached effect/finalACK/workflow/aktiveringsportar är kontrollportar; inga externa sidoeffekter utförs.

Kontrollerna når specifik giltig C/Z24 med accepted syntax/application/function och eget medlemsobjekt. Verklig casewriter härleder kund/punkt/LI/start från fysisk source; konstgjord avtalreferens tillfördes inte när input saknar den. Warning bär eget caseId, physical partition och verklig lowerSQL-orsak `z04c_effect_already_executed_compensation_required`, inga committed effekter och applied:false. Egen/främmande icke-tom affärsgraf samt originalidentitet/raw/hash hålls. Saknad eller terminal applicationworkflow konsumeras inte. Replay behåller ett case men varningar är per invocation; inga native deduplicerade kvitton påstås. Applied/approved/rejected/objectApplication-beslut behålls. CAS-förlust till färdigt operatörsbeslut behålls, ändrad oavgjord payload och foreigntenant ger precisa faults. Eventstoragefel propagerar efter modellens caseinsert; ingen transaktionsrollback eller beständig varning uppfinns.

Scaffoldförsök är tydligt historiska: CLI avvisade unsupported minWorkers; porten avvisade först felaktigt same-value companypatch; ärvd Sep22-reception nådde korrekt inte Handbok26B:s C-sourcepolicy före 1 oktober; ett förväntat agreementReference saknades faktiskt i source. Endast nya testport/nya assertions och den nya syntetiska källans mottagningstid före SDK-birth korrigerades. Inga gamla helpers, regelstartskydd eller produktbytes ändrades. Detta är inte produkt-RED/fix-bevis.

Native/SQL/backend/GEN/CI/whole-AT-Z04C/operatorcompletion/cancellation-first: **NOT_RUN eller ej bevisat**, +0 ledger. Current ledger323 och frysta krav är oförändrade. Två andra oberoende granskare ska nu bedöma exakt code+checkpointcarrier och denna tydliga evidensgräns.

### Original qualification JSON

SHA256 `18a7064508c666f11f6d1abb0f9b75d8d227f5f15798ae7564f447c2e8d4393d`; ordagrant bevarad.

<details><summary>Frozen source qualification</summary>

```json
{
  "scope": "ONE new finite C/Z24 compensation-review caller assertion file only; no whole AT-Z04C approval",
  "qualifiedAt": "2026-10-13T15:42:43.195265+00:00",
  "receipt": "359d27a100e3f5de4992e5abd921060c85988ae4",
  "packet": "a024ccc4-0148-4a8a-9d8d-7284f84a0446",
  "claim": "https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149092334",
  "commit": "e627eb13d09bbdaa8e7850be9113f371e18184f6",
  "tree": "855ca9157f3ba9a5e9ab80219d6b88ed2b6d4ae0",
  "orderedParents": [
    "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6"
  ],
  "sourceBase": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "sourceBaseTree": "e3b6c11677a2b871a128504f1616def7d22dba1e",
  "baseOrderedParents": [
    "95d8d160491e79b172342654d8dc643346758105",
    "fba453cc7cc9de8a26ec75d29248e1733316fcd1"
  ],
  "files": {
    "__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts": {
      "sha256": "1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2",
      "blob": "3870580e726a56d01367fa6dd19730621e0d63da",
      "mode": "100644",
      "lines": 202
    }
  },
  "custody": "Independently authenticated exact public fullreceipt JSON/tree/soleparent/base, exact one file ref GET_MATCH, CLAIM body, local base/tree/branch/clean/path ABSENT before firstwrite; solewriter exact onefile; root checkpoint untouched",
  "finiteResult": {
    "fileCount": 1,
    "tests": 10,
    "passed": 10,
    "failed": 0,
    "skipped": 0,
    "exitCode": 0,
    "node": "22.23.3",
    "vitest": "4.1.9",
    "sourceHash": "1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2",
    "firstGreenOriginal": "/tmp/ediel-z04c-6f94-fifth.json",
    "rerunOfGreen": false
  },
  "qualification": {
    "singleFileEslint": "PASS exact frozen source",
    "focusedStrictTs": "PASS exact frozen source; /tmp focused config imports real dependencies; incremental false/no repo type outputs",
    "stagedDiffCheck": "PASS",
    "otherExistingSource": "All source/helpers/config/SQL/frozen/ledger untouched; no broad/native/proof/GEN execution"
  },
  "actualCodeExecuted": [
    "processInboundEdielMessage coordinator",
    "resolveCanonicalRuntimeDecisionWithRegistry + actual complete physical national policy/grammar",
    "actual private own-source READ token issuance/decoding against declared provenance SDK",
    "applySupplyMarketSource native-result decoder",
    "createOrUpdateInboundProdatCase physical parser/pending-case writer/CAS/re-read",
    "createEdielMessageEvent actual parent read/event payload/storage writer"
  ],
  "modeledPorts": [
    "tenant lookup",
    "catalogue and source legal/reception/mail/parse/membership SDK transport",
    "lower SQL validation/composition/witness and exact compensation-held own partition; no SQL execution",
    "finite filtered table store for case/message/status/events; no PostgreSQL durability/RLS/unique-index attestation",
    "unreached final ACK/outbox, workflow and activation ports fail if invoked",
    "actor testing/automation observational sinks"
  ],
  "assertedBoundary": [
    "reached valid counted C/Z24 with accepted canonical syntax/application/function and accepted own member; real admission source from Oct13 before synthetic SDK birth",
    "actual pending_review C/Z24 case from physical source/customer/point/LI/start; cached foreign graph/date/original hints not adopted",
    "actual source-bound validated warning: own caseId + own physical partition + exact compensation cause + no committed effects/applied=false",
    "own and foreign nonempty business graphs/source immutable bytes/hash retained; no final ACK/automatic compensation/activation; missing and terminal application workflows uncalled",
    "case replay preserves one case and proper company/id/status/updated_at CAS; review warnings remain per-invocation rather than claiming deduplicated native receipt",
    "applied/approved/rejected/objectApplication prior reviews preserved; lost CAS final decision retained; changed undecided payload and foreign tenant fail exactly",
    "real event write error propagated after modeled case insert; no invented transaction-wide rollback or durable warning"
  ],
  "excludedClaims": [
    "native source authority/durability or actual lower PostgreSQL refusal",
    "authentic provider/counterparty/LIVE",
    "operator execution or completed controlled compensation",
    "cancellation-first processing/later original correlation",
    "whole AT-Z04C-SUPPLIER, whole contract/rule tag or coverage increase"
  ],
  "inputPremiseCorrection": "Existing C source READ correctly retains UNKNOWN before Handbok26B effective2026-10-01. New synthetic reception is explicitly Oct13 before immutable fixture birth. No old helper default/source/guide guard changed; no source acceptance bypass.",
  "retainedFirstOutputs": {
    "first": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/vitest/vitest.mjs",
        "run",
        "__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts",
        "--pool=threads",
        "--maxWorkers=1",
        "--minWorkers=1"
      ],
      "cwd": "/workspace/ediel-z04c-compensation-case-20261013-6f94",
      "sourceHead": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
      "testSHA256": "d682c15abd3d0ef50179a1fa398b36b88b8c431996f8467b098cb4359aee06f7",
      "startedAt": "2026-10-13T15:35:48.532029+00:00",
      "portLimit": "Explicit finite lower SQL/provenance/table ports; real coordinator/case/event/canonical code, not native/durability/whole acceptance",
      "stdout": {
        "path": "/tmp/ediel-z04c-6f94-first.stdout.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "stderr": {
        "path": "/tmp/ediel-z04c-6f94-first.stderr.log",
        "sha256": "5aeda7c170bb524fdbd3bc1fdb4c643aed9b05c72f64725c4d6d80a66b1f48d9",
        "bytes": 997
      },
      "exitCode": 1,
      "finishedAt": "2026-10-13T15:35:48.586738+00:00"
    },
    "second": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/vitest/vitest.mjs",
        "run",
        "__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts",
        "--pool=threads",
        "--maxWorkers=1"
      ],
      "cwd": "/workspace/ediel-z04c-compensation-case-20261013-6f94",
      "sourceHead": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
      "testSHA256": "d682c15abd3d0ef50179a1fa398b36b88b8c431996f8467b098cb4359aee06f7",
      "startedAt": "2026-10-13T15:36:06.250716+00:00",
      "portLimit": "Explicit finite lower SQL/provenance/table ports; real coordinator/case/event/canonical code, not native/durability/whole acceptance",
      "stdout": {
        "path": "/tmp/ediel-z04c-6f94-second.stdout.log",
        "sha256": "30f56978d0571cbf45f46cadcdae6133d38b5d84298574d04c925e80888be7db",
        "bytes": 1179
      },
      "stderr": {
        "path": "/tmp/ediel-z04c-6f94-second.stderr.log",
        "sha256": "a16c7274c06d98cb6e2c5bfcd86409498ebd020273565ff96c0444b4f9541a2a",
        "bytes": 5147
      },
      "exitCode": 1,
      "finishedAt": "2026-10-13T15:36:11.846259+00:00"
    },
    "third": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/vitest/vitest.mjs",
        "run",
        "__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts",
        "--pool=threads",
        "--maxWorkers=1"
      ],
      "cwd": "/workspace/ediel-z04c-compensation-case-20261013-6f94",
      "sourceHead": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
      "testSHA256": "6cc8a91d52344e75c3e94ecf4583fadfb290be48ee825e5ce1666b3b173a7f10",
      "startedAt": "2026-10-13T15:36:54.001051+00:00",
      "portLimit": "Explicit finite lower SQL/provenance/table ports; real coordinator/case/event/canonical code, not native/durability/whole acceptance",
      "stdout": {
        "path": "/tmp/ediel-z04c-6f94-third.stdout.log",
        "sha256": "2aa7edf51cedbcb12af76a75e9682e5e8ceb8c63139e2db81862915b3bd7ae5d",
        "bytes": 1184
      },
      "stderr": {
        "path": "/tmp/ediel-z04c-6f94-third.stderr.log",
        "sha256": "2e0d0dee8a0d6c7c9cd9f730c9896e08e102b6a2bf2ddc8dd88106704c5aa788",
        "bytes": 67616
      },
      "exitCode": 1,
      "finishedAt": "2026-10-13T15:37:01.223873+00:00"
    },
    "fourth": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/vitest/vitest.mjs",
        "run",
        "__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts",
        "--pool=threads",
        "--maxWorkers=1"
      ],
      "cwd": "/workspace/ediel-z04c-compensation-case-20261013-6f94",
      "sourceHead": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
      "testSHA256": "a5bf7c44c97c26c80db1bb8183d407c8bf72bc56430b8db6dca025f0e942c9b4",
      "startedAt": "2026-10-13T15:38:00.789022+00:00",
      "portLimit": "Explicit finite lower SQL/provenance/table ports; real coordinator/case/event/canonical code, not native/durability/whole acceptance",
      "stdout": {
        "path": "/tmp/ediel-z04c-6f94-fourth.stdout.log",
        "sha256": "8bbc4a27e8f237d7469cdabbb3c34f5b22e71e270ba74767d3e57b3af74d1642",
        "bytes": 552
      },
      "stderr": {
        "path": "/tmp/ediel-z04c-6f94-fourth.stderr.log",
        "sha256": "409c1391e03df59afc7a9a4530d143400654d42f8f6e958731121a706cc7c520",
        "bytes": 1118
      },
      "exitCode": 1,
      "finishedAt": "2026-10-13T15:38:06.590429+00:00"
    },
    "fifth": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/vitest/vitest.mjs",
        "run",
        "__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts",
        "--pool=threads",
        "--maxWorkers=1"
      ],
      "cwd": "/workspace/ediel-z04c-compensation-case-20261013-6f94",
      "sourceHead": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
      "testSHA256": "1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2",
      "startedAt": "2026-10-13T15:39:22.796858+00:00",
      "portLimit": "Explicit finite lower SQL/provenance/table ports; real coordinator/case/event/canonical code, not native/durability/whole acceptance",
      "stdout": {
        "path": "/tmp/ediel-z04c-6f94-fifth.stdout.log",
        "sha256": "255f4a00b1e1e272a8b702e4c7d96eae82d981a8419518f0d32baba12c48f936",
        "bytes": 240
      },
      "stderr": {
        "path": "/tmp/ediel-z04c-6f94-fifth.stderr.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "exitCode": 0,
      "finishedAt": "2026-10-13T15:39:28.763351+00:00"
    },
    "first-lint": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/eslint/bin/eslint.js",
        "__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts"
      ],
      "exitCode": 0,
      "testSHA256": "d682c15abd3d0ef50179a1fa398b36b88b8c431996f8467b098cb4359aee06f7",
      "stdout": {
        "path": "/tmp/ediel-z04c-6f94-first-lint.stdout.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "stderr": {
        "path": "/tmp/ediel-z04c-6f94-first-lint.stderr.log",
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
        "/tmp/ediel-z04c-6f94-tsconfig.json"
      ],
      "exitCode": 0,
      "testSHA256": "6cc8a91d52344e75c3e94ecf4583fadfb290be48ee825e5ce1666b3b173a7f10",
      "stdout": {
        "path": "/tmp/ediel-z04c-6f94-first-type.stdout.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "stderr": {
        "path": "/tmp/ediel-z04c-6f94-first-type.stderr.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      }
    },
    "final-lint": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/eslint/bin/eslint.js",
        "__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts"
      ],
      "exitCode": 0,
      "testSHA256": "1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2",
      "stdout": {
        "path": "/tmp/ediel-z04c-6f94-final-lint.stdout.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "stderr": {
        "path": "/tmp/ediel-z04c-6f94-final-lint.stderr.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      }
    },
    "final-type": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/typescript/bin/tsc",
        "--noEmit",
        "-p",
        "/tmp/ediel-z04c-6f94-tsconfig.json"
      ],
      "exitCode": 0,
      "testSHA256": "1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2",
      "stdout": {
        "path": "/tmp/ediel-z04c-6f94-final-type.stdout.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "stderr": {
        "path": "/tmp/ediel-z04c-6f94-final-type.stderr.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      }
    }
  },
  "historicalFailures": {
    "first": "CLI rejected unsupported --minWorkers before tests; original saved",
    "second": "10 tests:1PASS9FAIL; test storage port incorrectly rejected same-value existing tenant patch; fixed only new finite port to refuse changed identities",
    "third": "10 tests:1PASS9FAIL; inherited Sep22 reception correctly could not qualify C source-owned readings; actual caller never reached C domain path",
    "fourth": "10 tests:8PASS2FAIL; assertion guessed an absent physical agreement reference; corrected expected null rather than adding data",
    "fifth": "first valid final GREEN10/10, stderr empty; never rerun just for omitted output"
  },
  "controllerAndOtherArtifacts": {
    "/tmp/ediel-z04c-6f94-run-finite.py": {
      "sha256": "48342bd8aeea8c0fe083952ce710fe9da36e7a7f398a7e980a9398cf423a95e0",
      "bytes": 1467
    },
    "/tmp/ediel-z04c-6f94-first-controller.py": {
      "sha256": "5e222f0a730986ae24448e1d7278bc1e185cfc707b2910880c9f2958f7148422",
      "bytes": 1484
    },
    "/tmp/ediel-z04c-6f94-run-static.py": {
      "sha256": "fc65b2d6ba0f441abaf3039d28beb860f9586aa5e9f88176d13ad6230c947496",
      "bytes": 875
    },
    "/tmp/ediel-z04c-6f94-tsconfig.json": {
      "sha256": "00d747720c0c4eeffbe8541c7eabe1bf8500b0e8e069fcbcc8dd116fea8513cf",
      "bytes": 287
    },
    "/tmp/ediel-z04c-6f94-first-source.ts": {
      "sha256": "d682c15abd3d0ef50179a1fa398b36b88b8c431996f8467b098cb4359aee06f7",
      "bytes": 21061
    },
    "/tmp/ediel-z04c-6f94-final-diffcheck.stdout.log": {
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "bytes": 0
    },
    "/tmp/ediel-z04c-6f94-final-diffcheck.stderr.log": {
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "bytes": 0
    }
  },
  "unchangedSourceDependencyPins": {
    "lib/ediel/flows/inboundProcessing.ts": {
      "sha256": "e617ce5f322e220b8fec7448fc2e9faec33710be6cdb65b86d8a5f763d283e4f",
      "baseEqualsFinal": true
    },
    "lib/ediel/inboundCases.ts": {
      "sha256": "39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f",
      "baseEqualsFinal": true
    },
    "lib/ediel/db.ts": {
      "sha256": "572c45939c691fa8e9610b783273fbc84340175beea0bbb683a57114e9082ece",
      "baseEqualsFinal": true
    },
    "lib/ediel/flows/supplyMarketTransition.ts": {
      "sha256": "584e51953ca5da03ad9d216ce8e0e88cc09720b5dd1e7e8f6bcc7e4ec5995829",
      "baseEqualsFinal": true
    },
    "lib/ediel/core/runtimeDecision.ts": {
      "sha256": "d0f6be4c7fc8b84d5c1fccc43896bc5fd376e0b8c92e30d3b96452e1a14e11b3",
      "baseEqualsFinal": true
    },
    "lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations.ts": {
      "sha256": "bd861f45da5473fcac478bb1d604b40ede08f82bee34b96a1bbf12a80407e504",
      "baseEqualsFinal": true
    },
    "__tests__/helpers/prodatOwnSourceReadingFixture.ts": {
      "sha256": "ff0353dc388465fb901ed9b9bb475ed9d5bafc4ecbbd392ee241a4963ea1f327",
      "baseEqualsFinal": true
    },
    "__tests__/helpers/prodatOwnSourceReadingAdapter.ts": {
      "sha256": "fc4d5d8cd7f6a7398e6d498a092280dca1d9a1b4e4bdc3fd33ad8dce333c18ed",
      "baseEqualsFinal": true
    },
    "__tests__/helpers/sourceOwnerFixtures.ts": {
      "sha256": "5074fabfff69b734dd30480e957acd02e88107e8506fbf7111da0c2a4708c7c8",
      "baseEqualsFinal": true
    },
    "package-lock.json": {
      "sha256": "8bf0aca13c2f57d92db355bda81f38e526b3bd50a33db7859d272daad8d9f5c5",
      "baseEqualsFinal": true
    }
  },
  "ledger": "CURRENT base d798:323/352; old95d report320 is historical. This new file gives +0 and does not change NOT_EXECUTED Z04C.",
  "rootOwnedCheckpoint": ".agent-memory/ediel-z04c-compensation-case-20261013-6f94-checkpoint.md (untracked, untouched/uncommitted)",
  "nativeExecution": "NOT_RUN",
  "SQLExecution": "NOT_RUN",
  "GENExecution": "NOT_RUN",
  "publicationOrProducerAction": false,
  "state": "SOURCE_FROZEN_PAUSED_FOR_ROOT_CARRIER_AND_TWO_OTHER_FINAL_PEERS",
  "nextOwnerStep": "Root freezes its own unique checkpoint/carrier and routes two OTHER noncoauthor final source/evidence peers against exact final head/tree/base/orderedparents and original output hashes. No source write by implementer after freeze unless explicitly bounded findings handoff; all native/backend/original/GEN/CI/serial paths stay with current owners."
}
```

</details>

### Sparade körningsoriginal och controllers

Varje block är bytebevarat UTF8 från egen finit synthetic-scope, inklusive tomma outputfiler. Absoluta lokala paths är körningens sourcecontext. Felkörningar bevaras som historik, aldrig som godkända slutresultat. Root har matchat samtliga SHA256 före inbäddning; inga produktionskunddata/secrets eller fulla privata chattar ingår.

<details><summary>ediel-z04c-6f94-first.stdout.log (first stdout), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-first.stderr.log (first stderr), 997 bytes — SHA256 5aeda7c170bb524fdbd3bc1fdb4c643aed9b05c72f64725c4d6d80a66b1f48d9</summary>

```text
file:///workspace/ediel-fg-proof-20261013-6f94/node_modules/vitest/dist/chunks/cac.D3xHeqeL.js:406
          throw new CACError(`Unknown option \`${name.length > 1 ? `--${name}` : `-${name}`}\``);
                ^

CACError: Unknown option `--minWorkers`
    at Command.checkUnknownOptions (file:///workspace/ediel-fg-proof-20261013-6f94/node_modules/vitest/dist/chunks/cac.D3xHeqeL.js:406:17)
    at CAC.runMatchedCommand (file:///workspace/ediel-fg-proof-20261013-6f94/node_modules/vitest/dist/chunks/cac.D3xHeqeL.js:606:13)
    at CAC.parse (file:///workspace/ediel-fg-proof-20261013-6f94/node_modules/vitest/dist/chunks/cac.D3xHeqeL.js:547:12)
    at file:///workspace/ediel-fg-proof-20261013-6f94/node_modules/vitest/dist/cli.js:11:13
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.23.3
```

</details>

<details><summary>ediel-z04c-6f94-second.stdout.log (second stdout), 1179 bytes — SHA256 30f56978d0571cbf45f46cadcdae6133d38b5d84298574d04c925e80888be7db</summary>

```text

 RUN  v4.1.9 /workspace/ediel-z04c-compensation-case-20261013-6f94

 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts (10 tests | 9 failed) 199ms
   × real C/Z24 caller stores precise compensation review even with missing application workflow 88ms
   × real C/Z24 caller stores precise compensation review even with terminal application workflow 29ms
   × coordinator retains existing applied review instead of reopening it 15ms
   × coordinator retains existing approved review instead of reopening it 11ms
   × coordinator retains existing rejected review instead of reopening it 8ms
   × coordinator retains existing objectApplication review instead of reopening it 10ms
   × lost pending-case CAS retains a newly finalized operator decision through the actual reread 4ms
   × lost CAS with changed undecided payload refuses instead of overwriting the competing review 5ms
   × a foreign case returned by a broken finite read port is refused before any case update 5ms

 Test Files  1 failed (1)
      Tests  9 failed | 1 passed (10)
   Start at  15:36:06
   Duration  5.18s (transform 3.78s, setup 24ms, import 4.79s, tests 199ms, environment 0ms)

```

</details>

<details><summary>ediel-z04c-6f94-second.stderr.log (second stderr), 5147 bytes — SHA256 a16c7274c06d98cb6e2c5bfcd86409498ebd020273565ff96c0444b4f9541a2a</summary>

```text

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > real C/Z24 caller stores precise compensation review even with missing application workflow
 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > real C/Z24 caller stores precise compensation review even with terminal application workflow
Error: immutable_finite_source_write
 ❯ result __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:102:175

 ❯ Object.single __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:116:53
 ❯ execute __tests__/helpers/prodatOwnSourceReadingAdapter.ts:60:27
 ❯ Proxy.calls.push.name.name __tests__/helpers/prodatOwnSourceReadingAdapter.ts:64:83
 ❯ patchMessageTenant lib/ediel/core/tenantResolver.ts:318:6
 ❯ resolveInboundTenantForMessage lib/ediel/core/tenantResolver.ts:348:27
 ❯ Module.processInboundEdielMessage lib/ediel/flows/inboundProcessing.ts:1077:28
 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:152:49

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/9]⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > coordinator retains existing applied review instead of reopening it
 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > coordinator retains existing approved review instead of reopening it
 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > coordinator retains existing rejected review instead of reopening it
 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > coordinator retains existing objectApplication review instead of reopening it
Error: immutable_finite_source_write
 ❯ result __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:102:175

 ❯ Object.single __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:116:53
 ❯ execute __tests__/helpers/prodatOwnSourceReadingAdapter.ts:60:27
 ❯ Proxy.calls.push.name.name __tests__/helpers/prodatOwnSourceReadingAdapter.ts:64:83
 ❯ patchMessageTenant lib/ediel/core/tenantResolver.ts:318:6
 ❯ resolveInboundTenantForMessage lib/ediel/core/tenantResolver.ts:348:27
 ❯ Module.processInboundEdielMessage lib/ediel/flows/inboundProcessing.ts:1077:28
 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:166:2

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/9]⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > lost pending-case CAS retains a newly finalized operator decision through the actual reread
Error: immutable_finite_source_write
 ❯ result __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:102:175

 ❯ Object.single __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:116:53
 ❯ execute __tests__/helpers/prodatOwnSourceReadingAdapter.ts:60:27
 ❯ Proxy.calls.push.name.name __tests__/helpers/prodatOwnSourceReadingAdapter.ts:64:83
 ❯ patchMessageTenant lib/ediel/core/tenantResolver.ts:318:6
 ❯ resolveInboundTenantForMessage lib/ediel/core/tenantResolver.ts:348:27
 ❯ Module.processInboundEdielMessage lib/ediel/flows/inboundProcessing.ts:1077:28
 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:174:2

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/9]⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > lost CAS with changed undecided payload refuses instead of overwriting the competing review
Error: immutable_finite_source_write
 ❯ result __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:102:175

 ❯ Object.single __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:116:53
 ❯ execute __tests__/helpers/prodatOwnSourceReadingAdapter.ts:60:27
 ❯ Proxy.calls.push.name.name __tests__/helpers/prodatOwnSourceReadingAdapter.ts:64:83
 ❯ patchMessageTenant lib/ediel/core/tenantResolver.ts:318:6
 ❯ resolveInboundTenantForMessage lib/ediel/core/tenantResolver.ts:348:27
 ❯ Module.processInboundEdielMessage lib/ediel/flows/inboundProcessing.ts:1077:28
 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:182:2

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/9]⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > a foreign case returned by a broken finite read port is refused before any case update
Error: immutable_finite_source_write
 ❯ result __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:102:175

 ❯ Object.single __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:116:53
 ❯ execute __tests__/helpers/prodatOwnSourceReadingAdapter.ts:60:27
 ❯ Proxy.calls.push.name.name __tests__/helpers/prodatOwnSourceReadingAdapter.ts:64:83
 ❯ patchMessageTenant lib/ediel/core/tenantResolver.ts:318:6
 ❯ resolveInboundTenantForMessage lib/ediel/core/tenantResolver.ts:348:27
 ❯ Module.processInboundEdielMessage lib/ediel/flows/inboundProcessing.ts:1077:28
 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:188:2

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/9]⎯

```

</details>

<details><summary>ediel-z04c-6f94-third.stdout.log (third stdout), 1184 bytes — SHA256 2aa7edf51cedbcb12af76a75e9682e5e8ceb8c63139e2db81862915b3bd7ae5d</summary>

```text

 RUN  v4.1.9 /workspace/ediel-z04c-compensation-case-20261013-6f94

 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts (10 tests | 9 failed) 548ms
   × real C/Z24 caller stores precise compensation review even with missing application workflow 132ms
   × real C/Z24 caller stores precise compensation review even with terminal application workflow 50ms
   × coordinator retains existing applied review instead of reopening it 35ms
   × coordinator retains existing approved review instead of reopening it 33ms
   × coordinator retains existing rejected review instead of reopening it 37ms
   × coordinator retains existing objectApplication review instead of reopening it 32ms
   × lost pending-case CAS retains a newly finalized operator decision through the actual reread 73ms
   × lost CAS with changed undecided payload refuses instead of overwriting the competing review 81ms
   × a foreign case returned by a broken finite read port is refused before any case update 63ms

 Test Files  1 failed (1)
      Tests  9 failed | 1 passed (10)
   Start at  15:36:54
   Duration  6.74s (transform 4.68s, setup 22ms, import 6.02s, tests 548ms, environment 0ms)

```

</details>

<details><summary>ediel-z04c-6f94-third.stderr.log (third stderr), 67616 bytes — SHA256 2e0d0dee8a0d6c7c9cd9f730c9896e08e102b6a2bf2ddc8dd88106704c5aa788</summary>

```text

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > real C/Z24 caller stores precise compensation review even with missing application workflow
 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > real C/Z24 caller stores precise compensation review even with terminal application workflow
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

Received:

  1st vi.fn() call:

    Array [
      Object {
        "ackFamily": "CONTRL",
        "actorUserId": "00000000-0000-4000-8000-000000000050",
        "draft": [Object],
        "outcome": "positive",
        "sourceMessage": [Object],
      },
    ]


Number of calls: 1

 ❯ expectHeldReview __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:125:21
    123| function expectHeldReview(before:ReturnType<typeof graph>,identity:Ret…
    124|  expect(graph()).toEqual(before);expect(sourceIdentity()).toEqual(iden…
    125|  expect(io.ack).not.toHaveBeenCalled();expect(io.activation).not.toHav…
       |                     ^
    126|  expect(io.calls.filter(call=>call.name==='ediel_apply_supply_source_v…
    127|  expect(warning()).toHaveLength(1)
 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:152:61

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/9]⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > coordinator retains existing applied review instead of reopening it
 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > coordinator retains existing approved review instead of reopening it
 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > coordinator retains existing rejected review instead of reopening it
 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > coordinator retains existing objectApplication review instead of reopening it
TypeError: Cannot convert undefined or null to object
 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:167:9


⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/9]⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > lost pending-case CAS retains a newly finalized operator decision through the actual reread
AssertionError: expected undefined to match object { status: 'approved', …(1) }

- Expected:
{
  "review_decision": {
    "operatorStart": "declared_manual_decision",
  },
  "status": "approved",
}

+ Received:
undefined

 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:175:55
    173| it('lost pending-case CAS retains a newly finalized operator decision …
    174|  await run();io.queries=[];io.caseRace=row=>Object.assign(row,{status:…
    175|  await run();expect(io.tables.ediel_inbound_cases[0]).toMatchObject({s…
       |                                                       ^
    176|  const cas=io.queries.find(query=>query.table==='ediel_inbound_cases'&…
    177|  expect(cas.filters).toEqual(expect.arrayContaining([{name:'eq',args:[…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/9]⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > lost CAS with changed undecided payload refuses instead of overwriting the competing review
AssertionError: promise resolved "{ …(39) }" instead of rejecting

- Expected
+ Received

- Error {
-   "message": "rejected promise",
+ {
+   "application_reference": "23-DDQ-PRODAT",
+   "bgm_code": "Z04",
+   "bgm_reference": "D",
+   "business_match_status": "not_checked",
+   "company_id": "00000000-0000-4000-8000-000000000002",
+   "created_at": "2026-09-22T10:00:00Z",
+   "customer_id": "00000000-0000-4000-8000-000000000003",
+   "direction": "inbound",
+   "environment": "test",
+   "execution_context_snapshot": {
+     "receivedProdatContext": {
+       "capturedAt": "2026-09-22T10:00:00Z",
+       "companyId": "00000000-0000-4000-8000-000000000002",
+       "contextOrigin": "database_insert",
+       "environment": "test",
+       "messageCode": "Z04",
+       "payloadHash": "799752f31654838abcec9d0678866b3d23f90ecf58ed330462fedb7edab61ffe",
+       "sourceMessageId": "00000000-0000-4000-8000-000000000001",
+       "sourceReceivedAt": "2026-09-22T10:00:00Z",
+       "version": 1,
+     },
+   },
+   "failure_reason": undefined,
+   "id": "00000000-0000-4000-8000-000000000001",
+   "inbound_email_message_id": "00000000-0000-4000-8000-000000000060",
+   "interchange_reference": "I",
+   "message_code": "Z04",
+   "message_family": "PRODAT",
+   "message_received_at": "2026-09-22T10:00:00Z",
+   "message_reference": "M",
+   "message_standard": "edifact",
+   "metering_point_id": "00000000-0000-4000-8000-000000000004",
+   "parsed_at": "2026-10-13T15:37:01.020Z",
+   "parsed_payload": {
+     "canonical": {
+       "applicationReference": "23-DDQ-PRODAT",
+       "businessReference": "CASE-1",
+       "canonicalVersion": "2.5B",
+       "direction": "inbound",
+       "documentReference": "D",
+       "facilityId": "NET-1",
+       "facts": {
+         "parsedBy": "canonicalMessage",
+         "sourceFacts": {
+           "documentReference": "D",
+           "lineItemCount": 1,
+           "messageCode": "Z04",
+           "messageType": "PRODAT",
+         },
+       },
+       "family": "PRODAT",
+       "gridArea": null,
+       "interchangeReference": "I",
+       "messageCode": "Z04",
+       "messageReference": "M",
+       "messageStandard": "edifact",
+       "meteringPointId": "735123456789012345",
+       "parserWarnings": [],
+       "period": null,
+       "permissionId": null,
+       "processGroup": "supplier_switch",
+       "prodatIgnoredFields": [
+         {
+           "fieldNumber": "506",
+           "occurrence": {
+             "identityAgency": "9",
+             "lineIndex": 0,
+             "lineItemReference": "CASE-1",
+             "lineNumber": "1",
+             "messageReference": "M",
+             "objectId": "735123456789012345",
+             "ownReferences": {
+               "customerId": {
+                 "kind": "present",
+                 "value": "199001011234",
+               },
+               "lineItemReference": {
+                 "kind": "present",
+                 "value": "CASE-1",
+               },
+               "objectId": {
+                 "kind": "present",
+                 "value": "735123456789012345",
+               },
+             },
+             "registerPosition": 1,
+             "scope": "object",
+           },
+           "sourceRule": "PRODAT26A:P119",
+         },
+       ],
+       "prodatProcessingDisposition": {
+         "kind": "continue",
+         "reasons": [],
+       },
+       "quantities": [
+         {
+           "qualifier": "31",
+           "raw": "QTY+31:1000:KWH",
+           "value": "1000",
+         },
+       ],
+       "rawSegments": [
+         "UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DDQ-PRODAT++1++1",
+         "UNH+M+PRODAT:D:97A:UN:E2SE6A",
+         "BGM+Z04+D+9+AB",
+         "DTM+137:202609171200:203",
+         "DTM+ZZZ:1:805",
+         "NAD+FR+12345:160:SVK+++++++SE",
+         "NAD+DO+54321:160:SVK+++++++SE",
+         "LIN+1++735123456789012345:::9",
+         "DTM+92:202610010000:203",
+         "DTM+354:15:806",
+         "QTY+31:1000:KWH",
+         "CCI++Z13",
+         "CAV+Z24",
+         "CCI++Z04",
+         "CAV+Z03",
+         "CCI++Z07",
+         "CAV+Z12",
+         "CCI++Z12",
+         "CAV+:::D",
+         "CCI++Z15",
+         "CAV+Z32",
+         "CCI++Z14",
+         "CAV+:::L917:8716867000030",
+         "CCI++Z02",
+         "CAV+:::1",
+         "CCI++Z05",
+         "CAV+:::6",
+         "CCI++Z16",
+         "CAV+:::111",
+         "RFF+MG:METER-1",
+         "RFF+Z05:NET-1",
+         "RFF+LI:CASE-1",
+         "NAD+UD+199001011234:SE2:260++Synthetic+Street+City++12345+SE",
+         "NAD+IT+735123456789012345::9+++Street+Town++12345+SE",
+         "NAD+Z02+11111:160:SVK",
+         "UNT+35+M",
+         "UNZ+1+I",
+       ],
+       "receiver": "54321",
+       "receiverSubAddress": null,
+       "references": [
+         {
+           "qualifier": "MG",
+           "raw": "RFF+MG:METER-1",
+           "value": "METER-1",
+         },
+         {
+           "qualifier": "Z05",
+           "raw": "RFF+Z05:NET-1",
+           "value": "NET-1",
+         },
+         {
+           "qualifier": "LI",
+           "raw": "RFF+LI:CASE-1",
+           "value": "CASE-1",
+         },
+       ],
+       "relatedReference": null,
+       "sender": "12345",
+       "senderSubAddress": null,
+       "statuses": [],
+       "storageFamily": "PRODAT",
+       "subtype": "Z24",
+       "transactionReference": "CASE-1",
+       "version": "E2SE6A",
+     },
+     "customerId": "00000000-0000-4000-8000-000000000090",
+     "meterPointId": "FOREIGN-CACHED",
+     "original_message_id": "00000000-0000-4000-8000-000000000091",
+     "start_date": "1900-01-01",
+     "subtype": "L",
+     "tenantResolution": {
+       "candidateCompanyIds": [
+         "00000000-0000-4000-8000-000000000002",
+       ],
+       "companyId": "00000000-0000-4000-8000-000000000002",
+       "confidence": undefined,
+       "evidence": [
+         {
+           "companyId": "00000000-0000-4000-8000-000000000002",
+           "details": {
+             "modeled": true,
+           },
+           "score": 300,
+           "source": "verified_legal_identity",
+         },
+       ],
+       "marketActorEdielId": undefined,
+       "reasons": [],
+       "receiverEdielId": undefined,
+       "receiverSubaddress": undefined,
+       "source": undefined,
+       "status": "resolved",
+       "transportEdielId": undefined,
+       "warnings": [],
+     },
+   },
+   "processing_status": "validated",
+   "raw_payload": "UNA:+.? 'UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DDQ-PRODAT++1++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+D+9+AB'DTM+137:202609171200:203'DTM+ZZZ:1:805'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+54321:160:SVK+++++++SE'LIN+1++735123456789012345:::9'DTM+92:202610010000:203'DTM+354:15:806'QTY+31:1000:KWH'CCI++Z13'CAV+Z24'CCI++Z04'CAV+Z03'CCI++Z07'CAV+Z12'CCI++Z12'CAV+:::D'CCI++Z15'CAV+Z32'CCI++Z14'CAV+:::L917:8716867000030'CCI++Z02'CAV+:::1'CCI++Z05'CAV+:::6'CCI++Z16'CAV+:::111'RFF+MG:METER-1'RFF+Z05:NET-1'RFF+LI:CASE-1'NAD+UD+199001011234:SE2:260++Synthetic+Street+City++12345+SE'NAD+IT+735123456789012345::9+++Street+Town++12345+SE'NAD+Z02+11111:160:SVK'UNT+35+M'UNZ+1+I'",
+   "receiver_ediel_id": "54321",
+   "sender_ediel_id": "12345",
+   "site_id": "00000000-0000-4000-8000-000000000005",
+   "status": "validated",
+   "tenant_resolution_status": "tenant_resolved",
+   "test_flag": 1,
+   "transaction_reference": "CACHED-UNRELATED",
+   "unb_receiver_id": "54321",
+   "unb_receiver_subaddress": null,
+   "unb_sender_id": "12345",
+   "unb_sender_subaddress": null,
+   "updated_at": "2026-10-13T15:37:01.057Z",
+   "updated_by": "00000000-0000-4000-8000-000000000050",
+   "validated_at": "2026-10-13T15:37:01.057Z",
+   "validation_report": {
+     "applicationDecision": "accepted",
+     "canonicalRuntime": {
+       "applicationDecision": "accepted",
+       "canonicalPolicy": {
+         "ackRule": {
+           "acknowledgeIncomingMessageWith": [
+             "CONTRL",
+             "APERAK",
+           ],
+           "applicationAck": "APERAK",
+           "businessResponses": [],
+           "code": "*",
+           "family": "PRODAT",
+           "negativeApplicationResponse": "APERAK",
+           "technicalAck": "CONTRL",
+         },
+         "applicationReference": "23-DDQ-PRODAT",
+         "code": "Z04",
+         "family": "PRODAT",
+         "guide": {
+           "associationAssignedCode": "E2SE6A",
+           "authority": "Svenska kraftnät",
+           "certificationScope": "production_current",
+           "documentName": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+           "effectiveFrom": "2026-04-01",
+           "effectiveTo": null,
+           "family": "PRODAT",
+           "fieldMatrixStatus": "certified",
+           "guideRevision": "26-A",
+           "latestUpdated": "2026-06-30",
+         },
+         "prodatDependentConditions": [
+           {
+             "conditionId": "multiple_meter_registers",
+             "decisionPhase": "pre_wire_inventory_aggregate",
+             "fieldNumber": "258",
+             "id": "Z04:258",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Obligatorisk för anläggningar/mätare med flera register.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 258 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "meter_readings_sent_in_utilts",
+             "decisionPhase": "pre_wire_readings_aggregate",
+             "fieldNumber": "214",
+             "id": "Z04:214",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Obligatorisk om mätarställningar skickas i UTILTS.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 214 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "meter_readings_sent_in_utilts",
+             "decisionPhase": "pre_wire_readings_aggregate",
+             "fieldNumber": "218",
+             "id": "Z04:218",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Obligatorisk om mätarställningar skickas.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 218 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "meter_time_frame_business_rule",
+             "decisionPhase": "pre_wire_readings_aggregate",
+             "fieldNumber": "259",
+             "id": "Z04:259",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Räkneverkskod, P26.A §2.2 s.19–20; första registret.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 259 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "gas_market_only",
+             "fieldNumber": "320",
+             "id": "Z04:320",
+             "messageCode": "Z04",
+             "requirement": "forbidden",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Naturgas: Z04 samt Z06F/G krävs; Z06E får inte skickas.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 320 / D",
+             },
+             "status": "not_required",
+           },
+           {
+             "conditionId": "gas_market_only",
+             "fieldNumber": "240",
+             "id": "Z04:240",
+             "messageCode": "Z04",
+             "requirement": "forbidden",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Naturgas: Z04 krävs; Z06E frivillig; Z06F/G och Z10M krävs endast vid egen kausal serie-id-ändring.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 240 / D",
+             },
+             "status": "not_required",
+           },
+           {
+             "conditionId": "z04d_only",
+             "fieldNumber": "319",
+             "id": "Z04:319",
+             "messageCode": "Z04",
+             "requirement": "forbidden",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Obligatorisk i Z04D.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 319 / D; P26.A §2.2 s.21",
+             },
+             "status": "not_required",
+           },
+           {
+             "conditionId": "end_user_address_available",
+             "decisionPhase": "legacy_pre_wire_address_hint",
+             "fieldNumber": "229",
+             "id": "Z04:229",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "När elanvändaren anges ska adress fyllas i om den finns.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 229 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "INVOICEE_GROUP",
+             "id": "Z04:INVOICEE_GROUP",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Skickas om fakturamottagarens adress skiljer sig från elanvändarens.",
+               "section": "PRODAT 26-A field matrix: Z04 / field INVOICEE_GROUP / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "250",
+             "id": "Z04:250",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "När fakturamottagare skickas anges id.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 250 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "251",
+             "id": "Z04:251",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "1-2 rader.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 251 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "252",
+             "id": "Z04:252",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Adress fakturamottagare.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 252 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "253",
+             "id": "Z04:253",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Postnummer fakturamottagare.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 253 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "317",
+             "id": "Z04:317",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Postort fakturamottagare.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 317 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "318",
+             "id": "Z04:318",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Land fakturamottagare.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 318 / D",
+             },
+             "status": "undetermined",
+           },
+         ],
+         "profileKey": "prodat_z04_supplier_switch_confirmation",
+         "referenceDate": "2026-09-22",
+         "semantics": {
+           "autoStateMutationAllowed": true,
+           "bilateralPolicy": "none",
+           "businessEffect": "confirm_change_cancellation",
+           "businessProcess": "supplier_change_cancellation_confirmation",
+           "carriesQuantities": false,
+           "code": "Z04",
+           "dataScope": "metering_point",
+           "direction": "inbound",
+           "domainObject": "supply_relationship",
+           "expectedAcknowledgements": [
+             "CONTRL",
+             "APERAK",
+           ],
+           "expectedBusinessResponses": [],
+           "family": "PRODAT",
+           "historical": false,
+           "officialMeaning": "Grid-owner confirmation that the previously notified supplier change has been withdrawn.",
+           "operationKind": "response",
+           "receiverRoles": [
+             "supplier",
+           ],
+           "requestsData": false,
+           "requiresCustomerStatus": false,
+           "senderRoles": [
+             "grid_owner",
+           ],
+           "source": {
+             "document": "Ediel PRODAT/APERAK + Svensk Elmarknadshandbok",
+             "pageOrSection": "PRODAT field 223 and Handbook chapters 4, 10, 11",
+           },
+           "subtype": "C",
+           "supplierUtiltsSupport": null,
+           "transactionReasonCode": "Z24",
+         },
+         "sourceTrace": [
+           {
+             "authority": "guide",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "effective-dated guide registry",
+           },
+           {
+             "authority": "business_semantics",
+             "document": "Ediel PRODAT/APERAK + Svensk Elmarknadshandbok",
+             "section": "PRODAT field 223 and Handbook chapters 4, 10, 11",
+           },
+           {
+             "authority": "field_matrix",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "PRODAT 26.A field matrix",
+           },
+           {
+             "authority": "dependent_condition",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "PRODAT 26.A D-cell condition registry",
+           },
+           {
+             "authority": "application_reference",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "PRODAT Application Reference",
+           },
+           {
+             "authority": "acknowledgement",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "PRODAT/APERAK acknowledgement rules",
+           },
+         ],
+         "subtype": "C",
+         "timeAnchors": {
+           "actualSendAt": null,
+           "admissionAt": "2026-09-22T10:00:00.000Z",
+           "admissionDate": "2026-09-22",
+           "admissionSource": "local_ingress",
+           "businessEffectiveDate": "2026-09-17",
+           "documentDate": "2026-09-17",
+           "documentTimestamp": {
+             "format": "203",
+             "originalOffset": null,
+             "timeBasis": "fixed_UTC_plus_1",
+             "value": "202609171200",
+           },
+           "localIngressAt": "2026-09-22T10:00:00.000Z",
+           "measurementPeriods": [],
+           "replayAt": null,
+         },
+       },
+       "canonicalRuntimeVersion": "3.0-policy",
+       "decisionTrace": [
+         "Canonical parser: PRODAT Z04 (E2SE6A).",
+         "Syntax validator: accepterad.",
+         "PRODAT Z04C validerades mot en canonical policy med 15 D-villkor.",
+         "DB evidence verifierad för source-owned policy: prodat_z04_supplier_switch_confirmation.",
+       ],
+       "fieldRuleSource": "canonical_policy",
+       "functionalDecision": "accepted",
+       "issues": [
+         {
+           "code": "PRODAT_DEPENDENT_CONDITION_UNDETERMINED",
+           "description": "LIN 1, fält 214: Villkoret kan inte avgöras från objektets källstyrda fakta (P26.A §2.2 / bilaga2 s.114–116).",
+           "layer": "application",
+           "originalSeverity": "error",
+           "prodatAperakText": undefined,
+           "prodatDiagnostic": {
+             "kind": "local_unknown",
+             "reason": "Receiver-local readings condition unknown",
+             "sourceRule": "PRODAT26A:register-readings",
+           },
+           "severity": "warning",
+           "source": "validateCanonicalPolicyFields",
+           "title": "PRODAT registervillkor",
+         },
+         {
+           "code": "PRODAT_DEPENDENT_CONDITION_UNDETERMINED",
+           "description": "LIN 1, fält 218: Villkoret kan inte avgöras från objektets källstyrda fakta (P26.A §2.2 / bilaga2 s.114–116).",
+           "layer": "application",
+           "originalSeverity": "error",
+           "prodatAperakText": undefined,
+           "prodatDiagnostic": {
+             "kind": "local_unknown",
+             "reason": "Receiver-local readings condition unknown",
+             "sourceRule": "PRODAT26A:register-readings",
+           },
+           "severity": "warning",
+           "source": "validateCanonicalPolicyFields",
+           "title": "PRODAT registervillkor",
+         },
+         {
+           "code": "PRODAT_DEPENDENT_CONDITION_UNDETERMINED",
+           "description": "LIN 1, fält 259: Villkoret kan inte avgöras från objektets källstyrda fakta (P26.A §2.2 / bilaga2 s.114–116).",
+           "layer": "application",
+           "originalSeverity": "error",
+           "prodatAperakText": undefined,
+           "prodatDiagnostic": {
+             "kind": "local_unknown",
+             "reason": "Receiver-local readings condition unknown",
+             "sourceRule": "PRODAT26A:register-readings",
+           },
+           "severity": "warning",
+           "source": "validateCanonicalPolicyFields",
+           "title": "PRODAT registervillkor",
+         },
+       ],
+       "prodatIgnoredFields": [
+         {
+           "fieldNumber": "506",
+           "occurrence": {
+             "identityAgency": "9",
+             "lineIndex": 0,
+             "lineItemReference": "CASE-1",
+             "lineNumber": "1",
+             "messageReference": "M",
+             "objectId": "735123456789012345",
+             "ownReferences": {
+               "customerId": {
+                 "kind": "present",
+                 "value": "199001011234",
+               },
+               "lineItemReference": {
+                 "kind": "present",
+                 "value": "CASE-1",
+               },
+               "objectId": {
+                 "kind": "present",
+                 "value": "735123456789012345",
+               },
+             },
+             "registerPosition": 1,
+             "scope": "object",
+           },
+           "sourceRule": "PRODAT26A:P119",
+         },
+       ],
+       "prodatProcessingDisposition": {
+         "kind": "continue",
+         "reasons": [],
+       },
+       "responsePlan": [
+         {
+           "family": "CONTRL",
+           "outcome": "positive",
+           "reason": "Inbound EDIFACT är syntaxmässigt accepterat enligt canonical ACK authority.",
+         },
+         {
+           "erc": "100",
+           "family": "APERAK",
+           "ftx": "OK",
+           "outcome": "positive",
+           "reason": "PRODAT är accepterad enligt canonical policy och positiv APERAK krävs.",
+         },
+       ],
+       "rulePackEvidence": {
+         "databaseProfileKey": "PRODAT:Z04:C:26.A:r3",
+         "messageProfileId": "00000000-0000-4000-8000-000000000011",
+         "profileKey": "prodat_z04_supplier_switch_confirmation",
+         "rulePackId": "00000000-0000-4000-8000-000000000012",
+         "snapshot": {
+           "guideSources": [],
+           "messageProfile": {
+             "id": "00000000-0000-4000-8000-000000000011",
+             "profile": {
+               "canonicalDirection": "inbound",
+               "family": "PRODAT",
+               "guideRevision": "3",
+               "guideVersion": "26.A",
+               "messageCode": "Z04",
+               "reasonForTransaction": "Z24",
+               "transactionSubtype": "C",
+             },
+             "profile_key": "PRODAT:Z04:C:26.A:r3",
+             "rule_pack_id": "00000000-0000-4000-8000-000000000012",
+           },
+           "rulePack": {
+             "guide_revision": "3",
+             "guide_version": "26.A",
+             "id": "00000000-0000-4000-8000-000000000012",
+             "source_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
+           },
+         },
+         "sourceHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
+         "version": "26.A:r3",
+       },
+       "sourceRules": [
+         "CANONICAL_RUNTIME_3_0_POLICY",
+         "CANONICAL_EDIEL_POLICY",
+         "PRODAT_26A_POLICY_FIELD_VALIDATOR",
+         "PRODAT_DEPENDENT_CONDITION_ENGINE",
+         "RULE_PACK_EVIDENCE:prodat_z04_supplier_switch_confirmation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
+       ],
+       "syntax": {
+         "actualMessageSegmentCount": 35,
+         "declaredUntCount": 35,
+         "grammarQualification": "qualified",
+         "grammarSources": [
+           {
+             "archiveSha256": "4a8fbe74935a140b0982f9b555571831e7b9d90311acdbf195ae481e2fe705a8",
+             "key": "PRODAT:D:97A:UN",
+             "members": [
+               {
+                 "archiveMember": "EDIFACT/D97ADISK/EDMD.ZIP!EDIFACT/DIRECTOR/TRMD/PRODAT_D.97A",
+                 "sha256": "f6d6258573235c642889c2d7404774d1fc642db4cb70c46ef7bb93a1c95f6cf9",
+               },
+               {
+                 "archiveMember": "EDIFACT/D97ADISK/EDSD.ZIP!EDIFACT/DIRECTOR/TRSD/EDSD.97A",
+                 "sha256": "f8e67ec915604e16768b153cd6b837ab47e0fb31265e4cfc154db246bf6d7c11",
+               },
+               {
+                 "archiveMember": "EDIFACT/D97ADISK/EDCD.ZIP!EDIFACT/DIRECTOR/TRCD/EDCD.97A",
+                 "sha256": "545aba5d4df750784d023633685835385b2fdbb49853769b2c79bbd1b7ccf2c1",
+               },
+             ],
+             "messageIndex": 1,
+           },
+         ],
+         "issues": [],
+         "ok": true,
+       },
+       "syntaxDecision": "accepted",
+       "utiltsBusinessOutcome": null,
+     },
+     "canonicalRuntimeVersion": "2.5B",
+     "decisionTrace": [
+       "Canonical parser: PRODAT Z04 (E2SE6A).",
+       "Syntax validator: accepterad.",
+       "PRODAT Z04C validerades mot en canonical policy med 15 D-villkor.",
+       "DB evidence verifierad för source-owned policy: prodat_z04_supplier_switch_confirmation.",
+     ],
+     "functionalDecision": "accepted",
+     "prodatProcessingDisposition": {
+       "kind": "continue",
+       "reasons": [],
+     },
+     "receivedSourceValidationEvidence": {
+       "assessmentId": "00000000-0000-4000-8000-000000000077",
+       "factsHash": "8d55ec1942feb3398aa9b42eeb3d69f061885e1320fb0ad6e8d624b650449599",
+       "sourceDisposition": "not_established",
+       "status": "recorded",
+     },
+     "responsePlan": [
+       {
+         "family": "CONTRL",
+         "outcome": "positive",
+         "reason": "Inbound EDIFACT är syntaxmässigt accepterat enligt canonical ACK authority.",
+       },
+       {
+         "erc": "100",
+         "family": "APERAK",
+         "ftx": "OK",
+         "outcome": "positive",
+         "reason": "PRODAT är accepterad enligt canonical policy och positiv APERAK krävs.",
+       },
+     ],
+     "runtimeTenantResolutionSource": "persisted",
+     "sourceRules": [
+       "CANONICAL_RUNTIME_3_0_POLICY",
+       "CANONICAL_EDIEL_POLICY",
+       "PRODAT_26A_POLICY_FIELD_VALIDATOR",
+       "PRODAT_DEPENDENT_CONDITION_ENGINE",
+       "RULE_PACK_EVIDENCE:prodat_z04_supplier_switch_confirmation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
+     ],
+     "syntaxDecision": "accepted",
+     "tenantResolution": {
+       "candidateCompanyIds": [
+         "00000000-0000-4000-8000-000000000002",
+       ],
+       "companyId": "00000000-0000-4000-8000-000000000002",
+       "confidence": undefined,
+       "evidence": [
+         {
+           "companyId": "00000000-0000-4000-8000-000000000002",
+           "details": {
+             "modeled": true,
+           },
+           "score": 300,
+           "source": "verified_legal_identity",
+         },
+       ],
+       "marketActorEdielId": undefined,
+       "reasons": [],
+       "receiverEdielId": undefined,
+       "receiverSubaddress": undefined,
+       "source": undefined,
+       "status": "resolved",
+       "transportEdielId": undefined,
+       "warnings": [],
+     },
+   },
  }

 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:184:21
    182|  await run();const firstWarning=warning().length
    183|  io.caseRace=row=>Object.assign(row,{updated_at:'2026-10-13T15:31:00Z'…
    184|  await expect(run()).rejects.toThrow('PRODAT_INBOUND_CASE_CHANGED')
       |                     ^
    185|  expect(io.tables.ediel_inbound_cases[0].parsed_customer).toEqual({man…
    186| })

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/9]⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > a foreign case returned by a broken finite read port is refused before any case update
AssertionError: promise resolved "{ …(39) }" instead of rejecting

- Expected
+ Received

- Error {
-   "message": "rejected promise",
+ {
+   "application_reference": "23-DDQ-PRODAT",
+   "bgm_code": "Z04",
+   "bgm_reference": "D",
+   "business_match_status": "not_checked",
+   "company_id": "00000000-0000-4000-8000-000000000002",
+   "created_at": "2026-09-22T10:00:00Z",
+   "customer_id": "00000000-0000-4000-8000-000000000003",
+   "direction": "inbound",
+   "environment": "test",
+   "execution_context_snapshot": {
+     "receivedProdatContext": {
+       "capturedAt": "2026-09-22T10:00:00Z",
+       "companyId": "00000000-0000-4000-8000-000000000002",
+       "contextOrigin": "database_insert",
+       "environment": "test",
+       "messageCode": "Z04",
+       "payloadHash": "799752f31654838abcec9d0678866b3d23f90ecf58ed330462fedb7edab61ffe",
+       "sourceMessageId": "00000000-0000-4000-8000-000000000001",
+       "sourceReceivedAt": "2026-09-22T10:00:00Z",
+       "version": 1,
+     },
+   },
+   "failure_reason": undefined,
+   "id": "00000000-0000-4000-8000-000000000001",
+   "inbound_email_message_id": "00000000-0000-4000-8000-000000000060",
+   "interchange_reference": "I",
+   "message_code": "Z04",
+   "message_family": "PRODAT",
+   "message_received_at": "2026-09-22T10:00:00Z",
+   "message_reference": "M",
+   "message_standard": "edifact",
+   "metering_point_id": "00000000-0000-4000-8000-000000000004",
+   "parsed_at": "2026-10-13T15:37:01.095Z",
+   "parsed_payload": {
+     "canonical": {
+       "applicationReference": "23-DDQ-PRODAT",
+       "businessReference": "CASE-1",
+       "canonicalVersion": "2.5B",
+       "direction": "inbound",
+       "documentReference": "D",
+       "facilityId": "NET-1",
+       "facts": {
+         "parsedBy": "canonicalMessage",
+         "sourceFacts": {
+           "documentReference": "D",
+           "lineItemCount": 1,
+           "messageCode": "Z04",
+           "messageType": "PRODAT",
+         },
+       },
+       "family": "PRODAT",
+       "gridArea": null,
+       "interchangeReference": "I",
+       "messageCode": "Z04",
+       "messageReference": "M",
+       "messageStandard": "edifact",
+       "meteringPointId": "735123456789012345",
+       "parserWarnings": [],
+       "period": null,
+       "permissionId": null,
+       "processGroup": "supplier_switch",
+       "prodatIgnoredFields": [
+         {
+           "fieldNumber": "506",
+           "occurrence": {
+             "identityAgency": "9",
+             "lineIndex": 0,
+             "lineItemReference": "CASE-1",
+             "lineNumber": "1",
+             "messageReference": "M",
+             "objectId": "735123456789012345",
+             "ownReferences": {
+               "customerId": {
+                 "kind": "present",
+                 "value": "199001011234",
+               },
+               "lineItemReference": {
+                 "kind": "present",
+                 "value": "CASE-1",
+               },
+               "objectId": {
+                 "kind": "present",
+                 "value": "735123456789012345",
+               },
+             },
+             "registerPosition": 1,
+             "scope": "object",
+           },
+           "sourceRule": "PRODAT26A:P119",
+         },
+       ],
+       "prodatProcessingDisposition": {
+         "kind": "continue",
+         "reasons": [],
+       },
+       "quantities": [
+         {
+           "qualifier": "31",
+           "raw": "QTY+31:1000:KWH",
+           "value": "1000",
+         },
+       ],
+       "rawSegments": [
+         "UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DDQ-PRODAT++1++1",
+         "UNH+M+PRODAT:D:97A:UN:E2SE6A",
+         "BGM+Z04+D+9+AB",
+         "DTM+137:202609171200:203",
+         "DTM+ZZZ:1:805",
+         "NAD+FR+12345:160:SVK+++++++SE",
+         "NAD+DO+54321:160:SVK+++++++SE",
+         "LIN+1++735123456789012345:::9",
+         "DTM+92:202610010000:203",
+         "DTM+354:15:806",
+         "QTY+31:1000:KWH",
+         "CCI++Z13",
+         "CAV+Z24",
+         "CCI++Z04",
+         "CAV+Z03",
+         "CCI++Z07",
+         "CAV+Z12",
+         "CCI++Z12",
+         "CAV+:::D",
+         "CCI++Z15",
+         "CAV+Z32",
+         "CCI++Z14",
+         "CAV+:::L917:8716867000030",
+         "CCI++Z02",
+         "CAV+:::1",
+         "CCI++Z05",
+         "CAV+:::6",
+         "CCI++Z16",
+         "CAV+:::111",
+         "RFF+MG:METER-1",
+         "RFF+Z05:NET-1",
+         "RFF+LI:CASE-1",
+         "NAD+UD+199001011234:SE2:260++Synthetic+Street+City++12345+SE",
+         "NAD+IT+735123456789012345::9+++Street+Town++12345+SE",
+         "NAD+Z02+11111:160:SVK",
+         "UNT+35+M",
+         "UNZ+1+I",
+       ],
+       "receiver": "54321",
+       "receiverSubAddress": null,
+       "references": [
+         {
+           "qualifier": "MG",
+           "raw": "RFF+MG:METER-1",
+           "value": "METER-1",
+         },
+         {
+           "qualifier": "Z05",
+           "raw": "RFF+Z05:NET-1",
+           "value": "NET-1",
+         },
+         {
+           "qualifier": "LI",
+           "raw": "RFF+LI:CASE-1",
+           "value": "CASE-1",
+         },
+       ],
+       "relatedReference": null,
+       "sender": "12345",
+       "senderSubAddress": null,
+       "statuses": [],
+       "storageFamily": "PRODAT",
+       "subtype": "Z24",
+       "transactionReference": "CASE-1",
+       "version": "E2SE6A",
+     },
+     "customerId": "00000000-0000-4000-8000-000000000090",
+     "meterPointId": "FOREIGN-CACHED",
+     "original_message_id": "00000000-0000-4000-8000-000000000091",
+     "start_date": "1900-01-01",
+     "subtype": "L",
+     "tenantResolution": {
+       "candidateCompanyIds": [
+         "00000000-0000-4000-8000-000000000002",
+       ],
+       "companyId": "00000000-0000-4000-8000-000000000002",
+       "confidence": undefined,
+       "evidence": [
+         {
+           "companyId": "00000000-0000-4000-8000-000000000002",
+           "details": {
+             "modeled": true,
+           },
+           "score": 300,
+           "source": "verified_legal_identity",
+         },
+       ],
+       "marketActorEdielId": undefined,
+       "reasons": [],
+       "receiverEdielId": undefined,
+       "receiverSubaddress": undefined,
+       "source": undefined,
+       "status": "resolved",
+       "transportEdielId": undefined,
+       "warnings": [],
+     },
+   },
+   "processing_status": "validated",
+   "raw_payload": "UNA:+.? 'UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DDQ-PRODAT++1++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+D+9+AB'DTM+137:202609171200:203'DTM+ZZZ:1:805'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+54321:160:SVK+++++++SE'LIN+1++735123456789012345:::9'DTM+92:202610010000:203'DTM+354:15:806'QTY+31:1000:KWH'CCI++Z13'CAV+Z24'CCI++Z04'CAV+Z03'CCI++Z07'CAV+Z12'CCI++Z12'CAV+:::D'CCI++Z15'CAV+Z32'CCI++Z14'CAV+:::L917:8716867000030'CCI++Z02'CAV+:::1'CCI++Z05'CAV+:::6'CCI++Z16'CAV+:::111'RFF+MG:METER-1'RFF+Z05:NET-1'RFF+LI:CASE-1'NAD+UD+199001011234:SE2:260++Synthetic+Street+City++12345+SE'NAD+IT+735123456789012345::9+++Street+Town++12345+SE'NAD+Z02+11111:160:SVK'UNT+35+M'UNZ+1+I'",
+   "receiver_ediel_id": "54321",
+   "sender_ediel_id": "12345",
+   "site_id": "00000000-0000-4000-8000-000000000005",
+   "status": "validated",
+   "tenant_resolution_status": "tenant_resolved",
+   "test_flag": 1,
+   "transaction_reference": "CACHED-UNRELATED",
+   "unb_receiver_id": "54321",
+   "unb_receiver_subaddress": null,
+   "unb_sender_id": "12345",
+   "unb_sender_subaddress": null,
+   "updated_at": "2026-10-13T15:37:01.122Z",
+   "updated_by": "00000000-0000-4000-8000-000000000050",
+   "validated_at": "2026-10-13T15:37:01.122Z",
+   "validation_report": {
+     "applicationDecision": "accepted",
+     "canonicalRuntime": {
+       "applicationDecision": "accepted",
+       "canonicalPolicy": {
+         "ackRule": {
+           "acknowledgeIncomingMessageWith": [
+             "CONTRL",
+             "APERAK",
+           ],
+           "applicationAck": "APERAK",
+           "businessResponses": [],
+           "code": "*",
+           "family": "PRODAT",
+           "negativeApplicationResponse": "APERAK",
+           "technicalAck": "CONTRL",
+         },
+         "applicationReference": "23-DDQ-PRODAT",
+         "code": "Z04",
+         "family": "PRODAT",
+         "guide": {
+           "associationAssignedCode": "E2SE6A",
+           "authority": "Svenska kraftnät",
+           "certificationScope": "production_current",
+           "documentName": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+           "effectiveFrom": "2026-04-01",
+           "effectiveTo": null,
+           "family": "PRODAT",
+           "fieldMatrixStatus": "certified",
+           "guideRevision": "26-A",
+           "latestUpdated": "2026-06-30",
+         },
+         "prodatDependentConditions": [
+           {
+             "conditionId": "multiple_meter_registers",
+             "decisionPhase": "pre_wire_inventory_aggregate",
+             "fieldNumber": "258",
+             "id": "Z04:258",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Obligatorisk för anläggningar/mätare med flera register.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 258 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "meter_readings_sent_in_utilts",
+             "decisionPhase": "pre_wire_readings_aggregate",
+             "fieldNumber": "214",
+             "id": "Z04:214",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Obligatorisk om mätarställningar skickas i UTILTS.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 214 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "meter_readings_sent_in_utilts",
+             "decisionPhase": "pre_wire_readings_aggregate",
+             "fieldNumber": "218",
+             "id": "Z04:218",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Obligatorisk om mätarställningar skickas.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 218 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "meter_time_frame_business_rule",
+             "decisionPhase": "pre_wire_readings_aggregate",
+             "fieldNumber": "259",
+             "id": "Z04:259",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Räkneverkskod, P26.A §2.2 s.19–20; första registret.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 259 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "gas_market_only",
+             "fieldNumber": "320",
+             "id": "Z04:320",
+             "messageCode": "Z04",
+             "requirement": "forbidden",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Naturgas: Z04 samt Z06F/G krävs; Z06E får inte skickas.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 320 / D",
+             },
+             "status": "not_required",
+           },
+           {
+             "conditionId": "gas_market_only",
+             "fieldNumber": "240",
+             "id": "Z04:240",
+             "messageCode": "Z04",
+             "requirement": "forbidden",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Naturgas: Z04 krävs; Z06E frivillig; Z06F/G och Z10M krävs endast vid egen kausal serie-id-ändring.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 240 / D",
+             },
+             "status": "not_required",
+           },
+           {
+             "conditionId": "z04d_only",
+             "fieldNumber": "319",
+             "id": "Z04:319",
+             "messageCode": "Z04",
+             "requirement": "forbidden",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Obligatorisk i Z04D.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 319 / D; P26.A §2.2 s.21",
+             },
+             "status": "not_required",
+           },
+           {
+             "conditionId": "end_user_address_available",
+             "decisionPhase": "legacy_pre_wire_address_hint",
+             "fieldNumber": "229",
+             "id": "Z04:229",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "När elanvändaren anges ska adress fyllas i om den finns.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 229 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "INVOICEE_GROUP",
+             "id": "Z04:INVOICEE_GROUP",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Skickas om fakturamottagarens adress skiljer sig från elanvändarens.",
+               "section": "PRODAT 26-A field matrix: Z04 / field INVOICEE_GROUP / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "250",
+             "id": "Z04:250",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "När fakturamottagare skickas anges id.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 250 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "251",
+             "id": "Z04:251",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "1-2 rader.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 251 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "252",
+             "id": "Z04:252",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Adress fakturamottagare.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 252 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "253",
+             "id": "Z04:253",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Postnummer fakturamottagare.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 253 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "317",
+             "id": "Z04:317",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Postort fakturamottagare.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 317 / D",
+             },
+             "status": "undetermined",
+           },
+           {
+             "conditionId": "invoicee_address_differs",
+             "fieldNumber": "318",
+             "id": "Z04:318",
+             "messageCode": "Z04",
+             "source": {
+               "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+               "evidenceProjection": "supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql",
+               "note": "Land fakturamottagare.",
+               "section": "PRODAT 26-A field matrix: Z04 / field 318 / D",
+             },
+             "status": "undetermined",
+           },
+         ],
+         "profileKey": "prodat_z04_supplier_switch_confirmation",
+         "referenceDate": "2026-09-22",
+         "semantics": {
+           "autoStateMutationAllowed": true,
+           "bilateralPolicy": "none",
+           "businessEffect": "confirm_change_cancellation",
+           "businessProcess": "supplier_change_cancellation_confirmation",
+           "carriesQuantities": false,
+           "code": "Z04",
+           "dataScope": "metering_point",
+           "direction": "inbound",
+           "domainObject": "supply_relationship",
+           "expectedAcknowledgements": [
+             "CONTRL",
+             "APERAK",
+           ],
+           "expectedBusinessResponses": [],
+           "family": "PRODAT",
+           "historical": false,
+           "officialMeaning": "Grid-owner confirmation that the previously notified supplier change has been withdrawn.",
+           "operationKind": "response",
+           "receiverRoles": [
+             "supplier",
+           ],
+           "requestsData": false,
+           "requiresCustomerStatus": false,
+           "senderRoles": [
+             "grid_owner",
+           ],
+           "source": {
+             "document": "Ediel PRODAT/APERAK + Svensk Elmarknadshandbok",
+             "pageOrSection": "PRODAT field 223 and Handbook chapters 4, 10, 11",
+           },
+           "subtype": "C",
+           "supplierUtiltsSupport": null,
+           "transactionReasonCode": "Z24",
+         },
+         "sourceTrace": [
+           {
+             "authority": "guide",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "effective-dated guide registry",
+           },
+           {
+             "authority": "business_semantics",
+             "document": "Ediel PRODAT/APERAK + Svensk Elmarknadshandbok",
+             "section": "PRODAT field 223 and Handbook chapters 4, 10, 11",
+           },
+           {
+             "authority": "field_matrix",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "PRODAT 26.A field matrix",
+           },
+           {
+             "authority": "dependent_condition",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "PRODAT 26.A D-cell condition registry",
+           },
+           {
+             "authority": "application_reference",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "PRODAT Application Reference",
+           },
+           {
+             "authority": "acknowledgement",
+             "document": "260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B",
+             "section": "PRODAT/APERAK acknowledgement rules",
+           },
+         ],
+         "subtype": "C",
+         "timeAnchors": {
+           "actualSendAt": null,
+           "admissionAt": "2026-09-22T10:00:00.000Z",
+           "admissionDate": "2026-09-22",
+           "admissionSource": "local_ingress",
+           "businessEffectiveDate": "2026-09-17",
+           "documentDate": "2026-09-17",
+           "documentTimestamp": {
+             "format": "203",
+             "originalOffset": null,
+             "timeBasis": "fixed_UTC_plus_1",
+             "value": "202609171200",
+           },
+           "localIngressAt": "2026-09-22T10:00:00.000Z",
+           "measurementPeriods": [],
+           "replayAt": null,
+         },
+       },
+       "canonicalRuntimeVersion": "3.0-policy",
+       "decisionTrace": [
+         "Canonical parser: PRODAT Z04 (E2SE6A).",
+         "Syntax validator: accepterad.",
+         "PRODAT Z04C validerades mot en canonical policy med 15 D-villkor.",
+         "DB evidence verifierad för source-owned policy: prodat_z04_supplier_switch_confirmation.",
+       ],
+       "fieldRuleSource": "canonical_policy",
+       "functionalDecision": "accepted",
+       "issues": [
+         {
+           "code": "PRODAT_DEPENDENT_CONDITION_UNDETERMINED",
+           "description": "LIN 1, fält 214: Villkoret kan inte avgöras från objektets källstyrda fakta (P26.A §2.2 / bilaga2 s.114–116).",
+           "layer": "application",
+           "originalSeverity": "error",
+           "prodatAperakText": undefined,
+           "prodatDiagnostic": {
+             "kind": "local_unknown",
+             "reason": "Receiver-local readings condition unknown",
+             "sourceRule": "PRODAT26A:register-readings",
+           },
+           "severity": "warning",
+           "source": "validateCanonicalPolicyFields",
+           "title": "PRODAT registervillkor",
+         },
+         {
+           "code": "PRODAT_DEPENDENT_CONDITION_UNDETERMINED",
+           "description": "LIN 1, fält 218: Villkoret kan inte avgöras från objektets källstyrda fakta (P26.A §2.2 / bilaga2 s.114–116).",
+           "layer": "application",
+           "originalSeverity": "error",
+           "prodatAperakText": undefined,
+           "prodatDiagnostic": {
+             "kind": "local_unknown",
+             "reason": "Receiver-local readings condition unknown",
+             "sourceRule": "PRODAT26A:register-readings",
+           },
+           "severity": "warning",
+           "source": "validateCanonicalPolicyFields",
+           "title": "PRODAT registervillkor",
+         },
+         {
+           "code": "PRODAT_DEPENDENT_CONDITION_UNDETERMINED",
+           "description": "LIN 1, fält 259: Villkoret kan inte avgöras från objektets källstyrda fakta (P26.A §2.2 / bilaga2 s.114–116).",
+           "layer": "application",
+           "originalSeverity": "error",
+           "prodatAperakText": undefined,
+           "prodatDiagnostic": {
+             "kind": "local_unknown",
+             "reason": "Receiver-local readings condition unknown",
+             "sourceRule": "PRODAT26A:register-readings",
+           },
+           "severity": "warning",
+           "source": "validateCanonicalPolicyFields",
+           "title": "PRODAT registervillkor",
+         },
+       ],
+       "prodatIgnoredFields": [
+         {
+           "fieldNumber": "506",
+           "occurrence": {
+             "identityAgency": "9",
+             "lineIndex": 0,
+             "lineItemReference": "CASE-1",
+             "lineNumber": "1",
+             "messageReference": "M",
+             "objectId": "735123456789012345",
+             "ownReferences": {
+               "customerId": {
+                 "kind": "present",
+                 "value": "199001011234",
+               },
+               "lineItemReference": {
+                 "kind": "present",
+                 "value": "CASE-1",
+               },
+               "objectId": {
+                 "kind": "present",
+                 "value": "735123456789012345",
+               },
+             },
+             "registerPosition": 1,
+             "scope": "object",
+           },
+           "sourceRule": "PRODAT26A:P119",
+         },
+       ],
+       "prodatProcessingDisposition": {
+         "kind": "continue",
+         "reasons": [],
+       },
+       "responsePlan": [
+         {
+           "family": "CONTRL",
+           "outcome": "positive",
+           "reason": "Inbound EDIFACT är syntaxmässigt accepterat enligt canonical ACK authority.",
+         },
+         {
+           "erc": "100",
+           "family": "APERAK",
+           "ftx": "OK",
+           "outcome": "positive",
+           "reason": "PRODAT är accepterad enligt canonical policy och positiv APERAK krävs.",
+         },
+       ],
+       "rulePackEvidence": {
+         "databaseProfileKey": "PRODAT:Z04:C:26.A:r3",
+         "messageProfileId": "00000000-0000-4000-8000-000000000011",
+         "profileKey": "prodat_z04_supplier_switch_confirmation",
+         "rulePackId": "00000000-0000-4000-8000-000000000012",
+         "snapshot": {
+           "guideSources": [],
+           "messageProfile": {
+             "id": "00000000-0000-4000-8000-000000000011",
+             "profile": {
+               "canonicalDirection": "inbound",
+               "family": "PRODAT",
+               "guideRevision": "3",
+               "guideVersion": "26.A",
+               "messageCode": "Z04",
+               "reasonForTransaction": "Z24",
+               "transactionSubtype": "C",
+             },
+             "profile_key": "PRODAT:Z04:C:26.A:r3",
+             "rule_pack_id": "00000000-0000-4000-8000-000000000012",
+           },
+           "rulePack": {
+             "guide_revision": "3",
+             "guide_version": "26.A",
+             "id": "00000000-0000-4000-8000-000000000012",
+             "source_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
+           },
+         },
+         "sourceHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
+         "version": "26.A:r3",
+       },
+       "sourceRules": [
+         "CANONICAL_RUNTIME_3_0_POLICY",
+         "CANONICAL_EDIEL_POLICY",
+         "PRODAT_26A_POLICY_FIELD_VALIDATOR",
+         "PRODAT_DEPENDENT_CONDITION_ENGINE",
+         "RULE_PACK_EVIDENCE:prodat_z04_supplier_switch_confirmation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
+       ],
+       "syntax": {
+         "actualMessageSegmentCount": 35,
+         "declaredUntCount": 35,
+         "grammarQualification": "qualified",
+         "grammarSources": [
+           {
+             "archiveSha256": "4a8fbe74935a140b0982f9b555571831e7b9d90311acdbf195ae481e2fe705a8",
+             "key": "PRODAT:D:97A:UN",
+             "members": [
+               {
+                 "archiveMember": "EDIFACT/D97ADISK/EDMD.ZIP!EDIFACT/DIRECTOR/TRMD/PRODAT_D.97A",
+                 "sha256": "f6d6258573235c642889c2d7404774d1fc642db4cb70c46ef7bb93a1c95f6cf9",
+               },
+               {
+                 "archiveMember": "EDIFACT/D97ADISK/EDSD.ZIP!EDIFACT/DIRECTOR/TRSD/EDSD.97A",
+                 "sha256": "f8e67ec915604e16768b153cd6b837ab47e0fb31265e4cfc154db246bf6d7c11",
+               },
+               {
+                 "archiveMember": "EDIFACT/D97ADISK/EDCD.ZIP!EDIFACT/DIRECTOR/TRCD/EDCD.97A",
+                 "sha256": "545aba5d4df750784d023633685835385b2fdbb49853769b2c79bbd1b7ccf2c1",
+               },
+             ],
+             "messageIndex": 1,
+           },
+         ],
+         "issues": [],
+         "ok": true,
+       },
+       "syntaxDecision": "accepted",
+       "utiltsBusinessOutcome": null,
+     },
+     "canonicalRuntimeVersion": "2.5B",
+     "decisionTrace": [
+       "Canonical parser: PRODAT Z04 (E2SE6A).",
+       "Syntax validator: accepterad.",
+       "PRODAT Z04C validerades mot en canonical policy med 15 D-villkor.",
+       "DB evidence verifierad för source-owned policy: prodat_z04_supplier_switch_confirmation.",
+     ],
+     "functionalDecision": "accepted",
+     "prodatProcessingDisposition": {
+       "kind": "continue",
+       "reasons": [],
+     },
+     "receivedSourceValidationEvidence": {
+       "assessmentId": "00000000-0000-4000-8000-000000000077",
+       "factsHash": "8d55ec1942feb3398aa9b42eeb3d69f061885e1320fb0ad6e8d624b650449599",
+       "sourceDisposition": "not_established",
+       "status": "recorded",
+     },
+     "responsePlan": [
+       {
+         "family": "CONTRL",
+         "outcome": "positive",
+         "reason": "Inbound EDIFACT är syntaxmässigt accepterat enligt canonical ACK authority.",
+       },
+       {
+         "erc": "100",
+         "family": "APERAK",
+         "ftx": "OK",
+         "outcome": "positive",
+         "reason": "PRODAT är accepterad enligt canonical policy och positiv APERAK krävs.",
+       },
+     ],
+     "runtimeTenantResolutionSource": "persisted",
+     "sourceRules": [
+       "CANONICAL_RUNTIME_3_0_POLICY",
+       "CANONICAL_EDIEL_POLICY",
+       "PRODAT_26A_POLICY_FIELD_VALIDATOR",
+       "PRODAT_DEPENDENT_CONDITION_ENGINE",
+       "RULE_PACK_EVIDENCE:prodat_z04_supplier_switch_confirmation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
+     ],
+     "syntaxDecision": "accepted",
+     "tenantResolution": {
+       "candidateCompanyIds": [
+         "00000000-0000-4000-8000-000000000002",
+       ],
+       "companyId": "00000000-0000-4000-8000-000000000002",
+       "confidence": undefined,
+       "evidence": [
+         {
+           "companyId": "00000000-0000-4000-8000-000000000002",
+           "details": {
+             "modeled": true,
+           },
+           "score": 300,
+           "source": "verified_legal_identity",
+         },
+       ],
+       "marketActorEdielId": undefined,
+       "reasons": [],
+       "receiverEdielId": undefined,
+       "receiverSubaddress": undefined,
+       "source": undefined,
+       "status": "resolved",
+       "transportEdielId": undefined,
+       "warnings": [],
+     },
+   },
  }

 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:189:21


⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/9]⎯

```

</details>

<details><summary>ediel-z04c-6f94-fourth.stdout.log (fourth stdout), 552 bytes — SHA256 8bbc4a27e8f237d7469cdabbb3c34f5b22e71e270ba74767d3e57b3af74d1642</summary>

```text

 RUN  v4.1.9 /workspace/ediel-z04c-compensation-case-20261013-6f94

 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts (10 tests | 2 failed) 706ms
   × real C/Z24 caller stores precise compensation review even with missing application workflow 127ms
   × real C/Z24 caller stores precise compensation review even with terminal application workflow 53ms

 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
   Start at  15:38:01
   Duration  5.38s (transform 3.56s, setup 21ms, import 4.51s, tests 706ms, environment 0ms)

```

</details>

<details><summary>ediel-z04c-6f94-fourth.stderr.log (fourth stderr), 1118 bytes — SHA256 409c1391e03df59afc7a9a4530d143400654d42f8f6e958731121a706cc7c520</summary>

```text

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > real C/Z24 caller stores precise compensation review even with missing application workflow
 FAIL  __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts > real C/Z24 caller stores precise compensation review even with terminal application workflow
AssertionError: expected { …(22) } to match object { …(15) }
(28 matching properties omitted from actual)

- Expected
+ Received

@@ -5,11 +5,11 @@
    "ediel_message_id": "00000000-0000-4000-8000-000000000001",
    "id": "00000000-0000-4000-8000-000000000080",
    "message_code": "Z04",
    "metering_point_id": "00000000-0000-4000-8000-000000000004",
    "parsed_contract": {
-     "agreementReference": "AGREEMENT-1",
+     "agreementReference": null,
      "startDate": "202610010000",
    },
    "parsed_customer": {
      "personalNumber": "199001011234",
    },

 ❯ __tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts:157:16


⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

```

</details>

<details><summary>ediel-z04c-6f94-fifth.stdout.log (fifth stdout), 240 bytes — SHA256 255f4a00b1e1e272a8b702e4c7d96eae82d981a8419518f0d32baba12c48f936</summary>

```text

 RUN  v4.1.9 /workspace/ediel-z04c-compensation-case-20261013-6f94


 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  15:39:23
   Duration  5.60s (transform 3.69s, setup 22ms, import 4.66s, tests 762ms, environment 0ms)

```

</details>

<details><summary>ediel-z04c-6f94-fifth.stderr.log (fifth stderr), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-first-lint.stdout.log (first-lint stdout), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-first-lint.stderr.log (first-lint stderr), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-first-type.stdout.log (first-type stdout), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-first-type.stderr.log (first-type stderr), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-final-lint.stdout.log (final-lint stdout), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-final-lint.stderr.log (final-lint stderr), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-final-type.stdout.log (final-type stdout), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-final-type.stderr.log (final-type stderr), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-run-finite.py (controller/source/static original), 1467 bytes — SHA256 48342bd8aeea8c0fe083952ce710fe9da36e7a7f398a7e980a9398cf423a95e0</summary>

```python
import subprocess,hashlib,json,datetime,sys
from pathlib import Path
root=Path('/workspace/ediel-z04c-compensation-case-20261013-6f94')
node='/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node'
label=sys.argv[1];path='__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts'
command=[node,'node_modules/vitest/vitest.mjs','run',path,'--pool=threads','--maxWorkers=1']
prefix='/tmp/ediel-z04c-6f94-'+label
metadata={'command':command,'cwd':str(root),'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'testSHA256':hashlib.sha256((root/path).read_bytes()).hexdigest(),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'portLimit':'Explicit finite lower SQL/provenance/table ports; real coordinator/case/event/canonical code, not native/durability/whole acceptance'}
result=subprocess.run(command,cwd=root,capture_output=True)
for kind,raw in [('stdout',result.stdout),('stderr',result.stderr)]:
 out=Path(prefix+'.'+kind+'.log');assert not out.exists();out.write_bytes(raw);metadata[kind]={'path':str(out),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
metadata['exitCode']=result.returncode;metadata['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();Path(prefix+'.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2));print(result.stdout.decode());print(result.stderr.decode());sys.exit(result.returncode)
```

</details>

<details><summary>ediel-z04c-6f94-first-controller.py (controller/source/static original), 1484 bytes — SHA256 5e222f0a730986ae24448e1d7278bc1e185cfc707b2910880c9f2958f7148422</summary>

```python
import subprocess,hashlib,json,datetime,sys
from pathlib import Path
root=Path('/workspace/ediel-z04c-compensation-case-20261013-6f94')
node='/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node'
label=sys.argv[1];path='__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts'
command=[node,'node_modules/vitest/vitest.mjs','run',path,'--pool=threads','--maxWorkers=1','--minWorkers=1']
prefix='/tmp/ediel-z04c-6f94-'+label
metadata={'command':command,'cwd':str(root),'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'testSHA256':hashlib.sha256((root/path).read_bytes()).hexdigest(),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'portLimit':'Explicit finite lower SQL/provenance/table ports; real coordinator/case/event/canonical code, not native/durability/whole acceptance'}
result=subprocess.run(command,cwd=root,capture_output=True)
for kind,raw in [('stdout',result.stdout),('stderr',result.stderr)]:
 out=Path(prefix+'.'+kind+'.log');assert not out.exists();out.write_bytes(raw);metadata[kind]={'path':str(out),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
metadata['exitCode']=result.returncode;metadata['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();Path(prefix+'.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2));print(result.stdout.decode());print(result.stderr.decode());sys.exit(result.returncode)
```

</details>

<details><summary>ediel-z04c-6f94-run-static.py (controller/source/static original), 875 bytes — SHA256 fc65b2d6ba0f441abaf3039d28beb860f9586aa5e9f88176d13ad6230c947496</summary>

```python
import subprocess,hashlib,json,sys
from pathlib import Path
root=Path('/workspace/ediel-z04c-compensation-case-20261013-6f94');node='/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node';label=sys.argv[1]
cmd=[node,*sys.argv[2:]];p='/tmp/ediel-z04c-6f94-'+label;r=subprocess.run(cmd,cwd=root,capture_output=True)
meta={'command':cmd,'exitCode':r.returncode,'testSHA256':hashlib.sha256((root/'__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts').read_bytes()).hexdigest()}
for k,v in [('stdout',r.stdout),('stderr',r.stderr)]:
 out=Path(p+'.'+k+'.log');assert not out.exists();out.write_bytes(v);meta[k]={'path':str(out),'sha256':hashlib.sha256(v).hexdigest(),'bytes':len(v)}
Path(p+'.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta,indent=2));print(r.stdout.decode());print(r.stderr.decode());sys.exit(r.returncode)
```

</details>

<details><summary>ediel-z04c-6f94-tsconfig.json (controller/source/static original), 287 bytes — SHA256 00d747720c0c4eeffbe8541c7eabe1bf8500b0e8e069fcbcc8dd116fea8513cf</summary>

```json
{
  "extends": "/workspace/ediel-z04c-compensation-case-20261013-6f94/tsconfig.tests.json",
  "compilerOptions": {
    "incremental": false
  },
  "include": [
    "/workspace/ediel-z04c-compensation-case-20261013-6f94/__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts"
  ]
}
```

</details>

<details><summary>ediel-z04c-6f94-first-source.ts (controller/source/static original), 21061 bytes — SHA256 d682c15abd3d0ef50179a1fa398b36b88b8c431996f8467b098cb4359aee06f7</summary>

```typescript
// AT-Z04C-SUPPLIER finite consumer support only; no whole-ID tag/approval.
// Actual coordinator, canonical wire/owners, case parser/CAS and event writer.
// Lower SQL, catalogue/provenance SDK and tables are declared modeled ports:
// no PostgreSQL durability, native authority, compensation completion or
// cancellation-first/later-original execution is claimed by this component.
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
type Row=Record<string,unknown>
type Filter={name:string;args:unknown[]}
const io=vi.hoisted(()=>({tables:{} as Record<string,Row[]>,calls:[] as {name:string;args:Row}[],
 queries:[] as {table:string;operation:string;filters:Filter[];payload?:Row}[],trace:[] as string[],
 readings:null as ProdatOwnSourceReadingSdk|null,append:null as Row|null,
 caseRace:null as ((row:Row)=>void)|null,brokenCaseTenant:false,eventError:null as unknown,
 ack:vi.fn(),workflow:vi.fn(),activation:vi.fn()}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:(await import('./helpers/prodatOwnSourceReadingAdapter')).prodatOwnSourceReadingAdapter(()=>io.readings,{from:tablePort,rpc:sourceRpc})}))
// Declared tenant lookup port only. The coordinator's tenant/source handling,
// immutable-original SDK reader and canonical runtime still execute.
vi.mock('@/lib/ediel/tenant/resolveInboundTenant',async importOriginal=>({
 ...await importOriginal<typeof import('@/lib/ediel/tenant/resolveInboundTenant')>(),
 resolveInboundTenantFromIdentifiers:async(input:Row)=>{
  expect(input.receiverEdielId).toBe('54321');expect(input.marketActorEdielId).toBe('54321')
  return {status:'resolved',companyId:company,evidence:[{companyId:company,source:'verified_legal_identity',score:300,details:{modeled:true}}],candidateCompanyIds:[company],reasons:[],warnings:[]}
 }}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:(...args:unknown[])=>io.ack(...args)}))
vi.mock('@/lib/ediel/flows/receivedProdatStructuralAcks',()=>({createReceivedProdatCommittedEffectAcks:(...args:unknown[])=>io.ack(...args)}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:(...args:unknown[])=>io.ack(...args)}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>null}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:(...args:unknown[])=>io.workflow(...args)}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:(...args:unknown[])=>io.activation(...args)}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointForEdielMessage:()=>{throw Error('unexpected_legacy_matching')},matchSiteAndCustomerForMeteringPoint:()=>{throw Error('unexpected_legacy_matching')},findMatchingSupplierSwitchRequest:()=>{throw Error('unexpected_legacy_matching')}}))

import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {createOrUpdateInboundProdatCase} from '@/lib/ediel/inboundCases'
import {ownerSourceWithInstallationStatus,ownerRows,ownerId} from './helpers/sourceOwnerFixtures'
import {finiteProdatRulePack} from './helpers/prodatOwnSourceReadingAdapter'
import {createProdatOwnSourceReadingSdk,installProdatOwnSourceReadingFixture,resetProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
const company=ownerId(2),actor=ownerId(50),sourceId=ownerId(1),point='735123456789012345',caseId=ownerId(80)
const cause='z04c_effect_already_executed_compensation_required'
const catalogue=()=>finiteProdatRulePack('Z04','C','Z24')
function original(){return io.tables.ediel_messages.find(row=>row.id===sourceId)! as unknown as EdielMessageRow}
function physicalScope(){
 const wire=tokenizeEdifact(original().raw_payload!),lin=wire.segments.find(token=>token.tag==='LIN')!
 return {messageIndex:0,messageReference:segmentComposite(wire.segments.find(token=>token.tag==='UNH')!,1,wire.una)[0],
  objectId:segmentComposite(lin,3,wire.una)[0],identityAgency:'9',registers:[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:lin.index}]}
}
function sourceRpc(name:string,args:Row){
 io.calls.push({name,args:structuredClone(args)});io.trace.push(name)
 const hash=(field:string)=>typeof args[field]==='string'?evidenceHash(args[field] as string):null
 let data:unknown=null
 if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
  expect(args).toMatchObject({p_market:'electricity',p_family:'PRODAT',p_message_code:'Z04',p_transaction_subtype:'C',p_direction:'inbound'})
  data=[catalogue()]
 }else if(name==='gridex_actor_has_company_permission')data=args.p_company_id===company&&args.p_actor_user_id===actor&&['communication.write','ediel_testing.write'].includes(String(args.p_permission))
 else if(name==='ediel_read_technical_source_endpoint_v2')data=null
 else if(name==='gridex_record_prodat_source_validation_v6'){
  io.append=structuredClone(args)
  data={version:6,companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,
   factsHash:hash('p_facts_text'),sourceDisposition:'not_established',assessmentId:ownerId(77),objectFactsHash:hash('p_object_facts_text'),
   applicationFactsHash:hash('p_application_facts_text'),responseFactsHash:hash('p_response_facts_text'),ignoredFieldsHash:hash('p_ignored_fields_text'),sourceFunctionFactsHash:hash('p_source_function_facts_text')}
 }else if(name==='ediel_probe_source_rule_pack_capture_v1'){
  expect(io.append?.p_source_payload_hash).toBe(evidenceHash(original().raw_payload!))
  const r=catalogue();data={status:'captured',evidence:{rulePackId:r.rule_pack_id,messageProfileId:r.message_profile_id,profileKey:r.profile_key,version:r.original_version,sourceHash:r.source_hash,
   snapshot:{...r.original_snapshot,profileKey:r.profile_key,profileVersionId:r.message_profile_id,version:r.original_version,checksum:r.source_hash}}}
 }else if(name==='gridex_read_outbound_acks_for_source_v2')data={version:2,executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,sourceMessageId:sourceId,sourcePayloadHash:evidenceHash(original().raw_payload!),environment:'test',companyId:company,originals:[]}
 else if(name==='ediel_apply_supply_source_v1'){
  expect(args).toEqual({p_company_id:company,p_source_message_id:sourceId,p_actor_user_id:actor})
  expect(io.append?.p_source_payload_hash).toBe(evidenceHash(original().raw_payload!))
  const application=JSON.parse(String(io.append?.p_application_facts_text))
  expect(application).toMatchObject({headerDecision:'accepted',objects:[{objectId:point,applicationDecision:'accepted'}]})
  // Exact modeled lower-owner refusal. It performs no business table write.
  data={applied:false,reason:cause,idempotent:false,periods:[],commits:[],effectReceiptIds:[],partition:[{object:physicalScope(),disposition:'held',reason:cause}]}
 }else if(name==='gridex_record_source_object_decisions_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,
  sourcePayloadHash:args.p_source_payload_hash,canonicalAssessmentId:args.p_canonical_assessment_id,factsHash:hash('p_facts_text'),assessmentId:ownerId(78)}
 else if(name==='gridex_witness_source_objects_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,assessmentId:args.p_assessment_id,factsHash:args.p_facts_hash,witnessId:ownerId(79),availableAt:new Date().toISOString()}
 else throw Error('undeclared_finite_rpc:'+name)
 const result=Promise.resolve({data,error:null});return Object.assign(result,{abortSignal:()=>result})
}
// Finite query store: the actual production case/event writers supply payloads
// and filters. The store applies filters/CAS, never invents a desired case result.
function tablePort(table:string){
 if(!Object.hasOwn(io.tables,table))throw Error('undeclared_finite_table:'+table)
 const filters:Filter[]=[],tests:((row:Row)=>boolean)[]=[]
 let payload:Row|undefined,operation='select',columns='*',limit=Infinity
 const result=(single:boolean)=>{
  io.queries.push({table,operation,filters:structuredClone(filters),...(payload?{payload:structuredClone(payload)}:{})})
  let selected=io.tables[table].filter(row=>tests.every(test=>test(row))).slice(0,limit)
  if(operation==='update'&&table==='ediel_inbound_cases'&&io.caseRace&&selected[0]){
   const race=io.caseRace;io.caseRace=null;race(selected[0]);selected=io.tables[table].filter(row=>tests.every(test=>test(row))).slice(0,limit)
  }
  if(operation==='insert'){
   if(table==='ediel_message_events'&&io.eventError)return {data:null,error:io.eventError}
   if(!['ediel_inbound_cases','ediel_message_events'].includes(table))throw Error('forbidden_finite_insert:'+table)
   const row={id:table==='ediel_inbound_cases'?caseId:ownerId(100+io.tables[table].length),created_at:'2026-10-13T15:30:00Z',updated_at:'2026-10-13T15:30:00Z',...payload}
   io.tables[table].push(row);selected=[row];io.trace.push('stored:'+table)
  }else if(operation==='update'){
   if(!['ediel_messages','ediel_inbound_cases'].includes(table))throw Error('forbidden_finite_update:'+table)
   if(table==='ediel_messages'&&Object.keys(payload!).some(key=>['raw_payload','company_id','environment','direction','customer_id','metering_point_id'].includes(key)))throw Error('immutable_finite_source_write')
   selected.forEach(row=>Object.assign(row,payload));io.trace.push('updated:'+table)
  }
  if(table==='ediel_inbound_cases'&&operation==='select'&&io.brokenCaseTenant&&selected[0])selected=[{...selected[0],company_id:ownerId(90)}]
  const data=selected.map(row=>columns==='*'?structuredClone(row):Object.fromEntries(columns.split(',').map(key=>[key,row[key]])))
  return {data:single?data[0]??null:data,error:null,count:data.length}
 }
 const q={select:(value='*')=>{columns=value;return q},eq:(key:string,value:unknown)=>{filters.push({name:'eq',args:[key,value]});tests.push(row=>row[key]===value);return q},
  is:(key:string,value:unknown)=>{filters.push({name:'is',args:[key,value]});tests.push(row=>row[key]===value);return q},
  in:(key:string,values:unknown[])=>{filters.push({name:'in',args:[key,values]});tests.push(row=>values.includes(row[key]));return q},
  not:(key:string,_operator:string,value:unknown)=>{tests.push(row=>row[key]!==value);return q},
  or:(expression:string)=>{filters.push({name:'or',args:[expression]});const pairs=[...expression.matchAll(/([a-z_]+)\.eq\.("[^"]*"|[^,)]+)/g)].map(match=>[match[1],match[2].replace(/^"|"$/g,'')]);if(!pairs.length)throw Error('undeclared_finite_or');tests.push(row=>pairs.some(([key,value])=>row[key]===value));return q},
  limit:(value:number)=>{limit=value;return q},order:()=>q,abortSignal:()=>q,
  update:(value:Row)=>{payload=structuredClone(value);operation='update';return q},insert:(value:Row)=>{payload=structuredClone(value);operation='insert';return q},
  maybeSingle:async()=>result(true),single:async()=>result(true),then:(resolve:(value:ReturnType<typeof result>)=>unknown)=>Promise.resolve(result(false)).then(resolve)}
 return q
}
function graph(){return structuredClone(Object.fromEntries(['customers','customer_sites','metering_points','supplier_switch_requests','customer_supply_periods','customer_application_workflows'].map(table=>[table,io.tables[table]])))}
function sourceIdentity(){const m=original();return {id:m.id,company:m.company_id,environment:m.environment,direction:m.direction,raw:m.raw_payload,hash:evidenceHash(m.raw_payload!)}}
const run=()=>processInboundEdielMessage({actorUserId:actor,edielMessageId:sourceId})
function warning(){return io.tables.ediel_message_events.filter(event=>event.event_type==='validated'&&(event.event_payload as Row)?.reviewRequired===true)}
function expectHeldReview(before:ReturnType<typeof graph>,identity:ReturnType<typeof sourceIdentity>){
 expect(graph()).toEqual(before);expect(sourceIdentity()).toEqual(identity)
 expect(io.ack).not.toHaveBeenCalled();expect(io.activation).not.toHaveBeenCalled();expect(io.workflow).not.toHaveBeenCalled()
 expect(io.calls.filter(call=>call.name==='ediel_apply_supply_source_v1')).toHaveLength(1)
 expect(warning()).toHaveLength(1)
 expect(warning()[0]).toMatchObject({company_id:company,ediel_message_id:sourceId,message_id:sourceId,event_status:'warning',created_by:actor,
  event_payload:{inboundCaseId:caseId,reviewRequired:true,fullyApplied:false,applied:false,idempotent:false,committedEffectReceiptIds:[],sourceObjectPartition:[{object:physicalScope(),disposition:'held',reason:cause}]}})
 expect(warning()[0].payload).toEqual(warning()[0].event_payload)
 expect(io.trace.indexOf('ediel_apply_supply_source_v1')).toBeLessThan(io.trace.indexOf('stored:ediel_inbound_cases'))
 const inserts=io.queries.filter(query=>query.operation==='insert')
 expect(inserts.every(query=>['ediel_inbound_cases','ediel_message_events'].includes(query.table))).toBe(true)
}
beforeEach(()=>{
 vi.clearAllMocks();io.calls=[];io.queries=[];io.trace=[];io.append=null;io.caseRace=null;io.brokenCaseTenant=false;io.eventError=null
 io.ack.mockImplementation(()=>{throw Error('unexpected_final_ack')});io.activation.mockImplementation(()=>{throw Error('unexpected_activation')});io.workflow.mockImplementation(()=>{throw Error('missing_or_terminal_workflow_must_not_be_used')})
 const m=ownerSourceWithInstallationStatus('Z12',{readingDeclarations:true,sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}})
 m.raw_payload=m.raw_payload!.replace('CAV+Z22','CAV+Z24').replace('CUSTOMER-1::89','199001011234:SE2:260')
 m.execution_context_snapshot={receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:sourceId,companyId:company,environment:'test',messageCode:'Z04',payloadHash:evidenceHash(m.raw_payload),sourceReceivedAt:m.message_received_at,capturedAt:m.message_received_at}}
 m.parsed_payload={subtype:'L',start_date:'1900-01-01',customerId:ownerId(90),meterPointId:'FOREIGN-CACHED',original_message_id:ownerId(91)}
 io.tables={...ownerRows(),ediel_messages:[m as unknown as Row],ediel_inbound_cases:[],ediel_message_events:[],
  customers:[{id:ownerId(3),company_id:company,personal_number:'199001011234'}],customer_application_workflows:[],
  customer_supply_periods:[{id:ownerId(8),company_id:company,customer_id:ownerId(3),metering_point_id:ownerId(4),status:'active',source_message_id:ownerId(20),market_state_version:7},
   {id:ownerId(98),company_id:ownerId(90),customer_id:ownerId(93),metering_point_id:ownerId(94),status:'active',market_state_version:9}],
  supplier_switch_requests:[{id:ownerId(7),company_id:company,customer_id:ownerId(3),metering_point_id:ownerId(4),status:'completed',outbound_z03_message_id:ownerId(21)}]}
 io.readings=createProdatOwnSourceReadingSdk();resetProdatOwnSourceReadingSdk(io.readings)
 installProdatOwnSourceReadingFixture(io.readings,m,'C',{actorUserId:actor,receivedAt:m.message_received_at!,mailId:m.inbound_email_message_id!,parseId:ownerId(61),receptionId:ownerId(62),legalActorId:ownerId(9)})
})
it.each(['missing','terminal'])('real C/Z24 caller stores precise compensation review even with %s application workflow',async mode=>{
 if(mode==='terminal')io.tables.customer_application_workflows=[{id:ownerId(30),company_id:company,customer_id:ownerId(3),state:'completed',next_action:'none'}]
 const before=graph(),identity=sourceIdentity();await run();expectHeldReview(before,identity)
 const saved=io.tables.ediel_inbound_cases[0]
 expect(saved).toMatchObject({id:caseId,company_id:company,ediel_message_id:sourceId,message_code:'Z04',transaction_type:'Z24',status:'pending_review',created_by:actor,updated_by:actor,
  customer_id:ownerId(3),site_id:ownerId(5),metering_point_id:ownerId(4),parsed_customer:{personalNumber:'199001011234'},parsed_metering_point:{meterPointId:point,identityAgency:'9'},parsed_contract:{startDate:'202610010000',agreementReference:'AGREEMENT-1'},proposed_action:{action:'pending_admin_review',objectCount:1}})
 const scopes=(saved.proposed_action as {objects:{meteringPointId:string;registers:{lineItemReference:string}[]}[]}).objects
 expect(scopes[0].meteringPointId).toBe(point);expect(scopes[0].registers[0].lineItemReference).toBe('CASE-1')
 // The review is an operator handoff, never proof of operator execution.
 const first=structuredClone(saved);await run()
 expect(io.tables.ediel_inbound_cases).toHaveLength(1);expect(io.tables.ediel_inbound_cases[0]).toEqual(first)
 expect(warning()).toHaveLength(2);expect(graph()).toEqual(before);expect(sourceIdentity()).toEqual(identity);expect(io.ack).not.toHaveBeenCalled()
 const updates=io.queries.filter(query=>query.table==='ediel_inbound_cases'&&query.operation==='update')
 expect(updates).toHaveLength(1);expect(updates[0].filters).toEqual(expect.arrayContaining([{name:'eq',args:['id',caseId]},{name:'eq',args:['company_id',company]},{name:'eq',args:['status','pending_review']},{name:'eq',args:['updated_at',first.updated_at]}]))
})
it.each(['applied','approved','rejected','objectApplication'])('coordinator retains existing %s review instead of reopening it',async state=>{
 await run();const saved=io.tables.ediel_inbound_cases[0]
 Object.assign(saved,{status:state==='objectApplication'?'pending_review':state,review_decision:state==='objectApplication'?{objectApplication:{lineIndices:[physicalScope().registers[0].segmentIndex],retained:true}}:{retained:'manual'},reviewed_by:ownerId(55),reviewed_at:'2026-10-12T12:00:00Z'})
 const retained=structuredClone(saved),before=graph();io.queries=[];await run()
 expect(io.tables.ediel_inbound_cases).toEqual([retained]);expect(graph()).toEqual(before)
 expect(io.queries.filter(query=>query.table==='ediel_inbound_cases'&&query.operation!=='select')).toEqual([])
 expect(warning().at(-1)).toMatchObject({event_payload:{inboundCaseId:caseId,sourceObjectPartition:[{disposition:'held',reason:cause}]}});expect(io.ack).not.toHaveBeenCalled()
})
it('lost pending-case CAS retains a newly finalized operator decision through the actual reread',async()=>{
 await run();io.queries=[];io.caseRace=row=>Object.assign(row,{status:'approved',updated_at:'2026-10-13T15:31:00Z',review_decision:{operatorStart:'declared_manual_decision'}})
 await run();expect(io.tables.ediel_inbound_cases[0]).toMatchObject({status:'approved',review_decision:{operatorStart:'declared_manual_decision'}})
 const cas=io.queries.find(query=>query.table==='ediel_inbound_cases'&&query.operation==='update')!
 expect(cas.filters).toEqual(expect.arrayContaining([{name:'eq',args:['id',caseId]},{name:'eq',args:['company_id',company]},{name:'eq',args:['status','pending_review']}]))
 expect(io.queries).toContainEqual(expect.objectContaining({table:'ediel_inbound_cases',operation:'select',filters:expect.arrayContaining([{name:'eq',args:['id',caseId]},{name:'eq',args:['ediel_message_id',sourceId]},{name:'eq',args:['company_id',company]}])}))
 expect(warning().at(-1)).toMatchObject({event_payload:{inboundCaseId:caseId,applied:false}});expect(io.ack).not.toHaveBeenCalled()
})
it('lost CAS with changed undecided payload refuses instead of overwriting the competing review',async()=>{
 await run();const firstWarning=warning().length
 io.caseRace=row=>Object.assign(row,{updated_at:'2026-10-13T15:31:00Z',parsed_customer:{manualChange:'retain'}})
 await expect(run()).rejects.toThrow('PRODAT_INBOUND_CASE_CHANGED')
 expect(io.tables.ediel_inbound_cases[0].parsed_customer).toEqual({manualChange:'retain'});expect(warning()).toHaveLength(firstWarning);expect(io.ack).not.toHaveBeenCalled()
})
it('a foreign case returned by a broken finite read port is refused before any case update',async()=>{
 await run();const retained=structuredClone(io.tables.ediel_inbound_cases);io.queries=[];io.brokenCaseTenant=true
 await expect(run()).rejects.toThrow('TENANT_CONTEXT_MISMATCH')
 expect(io.tables.ediel_inbound_cases).toEqual(retained);expect(io.queries.filter(query=>query.table==='ediel_inbound_cases'&&query.operation==='update')).toEqual([]);expect(io.ack).not.toHaveBeenCalled()
})
it('real case writer propagates a warning storage failure without claiming an operator start',async()=>{
 const error={code:'42501',message:'declared warning storage denied'};io.eventError=error
 await expect(createOrUpdateInboundProdatCase({actorUserId:actor,message:original()})).rejects.toBe(error)
 // The case INSERT occurred before the real event write; no transaction-wide
 // rollback or durable warning is invented by this finite storage model.
 expect(io.tables.ediel_inbound_cases).toHaveLength(1);expect(warning()).toEqual([]);expect(io.ack).not.toHaveBeenCalled()
})
```

</details>

<details><summary>ediel-z04c-6f94-final-diffcheck.stdout.log (controller/source/static original), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-z04c-6f94-final-diffcheck.stderr.log (controller/source/static original), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>


## Två oberoende slutgranskningar

Både `/root/fg_final_review_a` och `/root/fg_final_review_b` har separat granskat hela tvåfilskomponenten vid `0e77d95531f9a01a37212ef8f2731b482e4a766f`/tree `301ae77579de8aee8d015909dde841227107dbdc`, ordnad parent `[e627eb13d09bbdaa8e7850be9113f371e18184f6]`, sourcee627/tree855ca och faktisk bas d798/e3b6. Båda är icke-medförfattare till kod/test/fixture/körningsbevis och har inte kört prov eller konsulterat varandra. Båda ger **SOURCE_APPROVE**, ingen bekräftad P1/P2. Tio finita observationer och exakta sparade original är kvalificerade i sitt begränsade källscope; nativeauktoritet/DBdurabilitet/operatorcompletion/arrivalorder/whole-ID/CI/GEN/merge förblir uttryckligen ej bevisade.

Det här senare dokumenttillägget bevarar originalrapporterna och ändrar endast eget checkpoint. Koden och övriga leaves förblir exakt samma. Båda granskare ska binda slutligt head/tree/parent till detta dokument före källöverlämningen; slutkvittot på #766 publicerar dessa värden och rebindresultat utan fabricerad självreferens.

<details><summary>ediel-z04c-6f94-final-review-a-0e77d955.md — SHA256 c2ed8c8a6ce4ff53157e5e2c2f5e77779f9a71c13197e7830eacb012baea3dc3</summary>

```markdown
# Independent final source/evidence review A — Z04C finite consumer

**SOURCE_APPROVE** for the complete two-file component at the exact immutable H1 below. No confirmed P1/P2 finding. This approves the bounded source consumer assertion and its evidence description; it does not approve the whole AT-Z04C contract, native execution, current CI, or merge readiness.

## Exact binding and independence

- Final H1: `0e77d95531f9a01a37212ef8f2731b482e4a766f`; tree `301ae77579de8aee8d015909dde841227107dbdc`; ordered parents [`e627eb13d09bbdaa8e7850be9113f371e18184f6`].
- Frozen code: `e627eb13d09bbdaa8e7850be9113f371e18184f6`; tree `855ca9157f3ba9a5e9ab80219d6b88ed2b6d4ae0`; ordered parents [`d798eb36f35cd4f437d44c8d234b4dbb81adc7a6`].
- Actual source/base: `d798eb36f35cd4f437d44c8d234b4dbb81adc7a6`; tree `e3b6c11677a2b871a128504f1616def7d22dba1e`; ordered parents [`95d8d160491e79b172342654d8dc643346758105`, `fba453cc7cc9de8a26ec75d29248e1733316fcd1`].
- Workspace: `/workspace/ediel-z04c-compensation-case-20261013-6f94`, clean and at H1 when inspected.
- One source-path custody receipt: `359d27a100e3f5de4992e5abd921060c85988ae4`; CLAIM `6149092334`; packet `a024ccc4-0148-4a8a-9d8d-7284f84a0446`; helper IDs empty; no producer scope. The source writer is `/root/z06fg_requirements`; root owns only its unique checkpoint.

| Added path | Exact SHA256 |
| --- | --- |
| `__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts` | `1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2` |
| `.agent-memory/ediel-z04c-compensation-case-20261013-6f94-checkpoint.md` | `88faf28a37a9dd0586ab1ba1fdd7e61820e359b0389d0e9c35b6fbd235dbc4a1` |

The test is 202 lines, 21,500 bytes, blob `3870580e726a56d01367fa6dd19730621e0d63da`; the checkpoint is 183,083 bytes. Base→H1 contains exactly these two additions. I did not author code, tests, fixtures, controllers, checkpoint, or proof and did not run qualification. This independent review used exact Git source/diffs and read-only local evidence/hash comparisons, with no peer consultation. The sole new file I created is this report.

Skill routing: code-review/differential-review for the complete component and changed-path scope; spec-to-code for the frozen literal boundary; direct false-positive checks for potential oracle issues; verification-before-completion for immutable evidence applicability. Existing Supabase/source-port and PostgreSQL source guidance applies to the caller trace. No broad database/security audit, remediation, native testing, browser/UI, performance, supply-chain scan, or producer workflow was activated by this two-file scope. AGENTS, active memory/start/workflow/reservations, relevant decisions/failures, and the local code-reviewer template were read. Dated memory is not treated as current ownership or ledger authority.

## Requirements and actual consumer trace

The unchanged frozen AT-Z04C card requires supplier `23-DDQ-PRODAT`, BGM Z04/field223 Z24, prescribed CONTRL/APERAK, exact original/object/order handling, no wrong-role/direction/R-D/correlation/mutation execution, and controlled compensation when an effect was already executed. The supporting TEN-05, P-01, and ENV-06 literal rules remain unchanged. This component covers only the real consumer's compensation-held review handoff. It does not establish the card's physical cancellation-first/later-original sequence, actual cancellation/compensation execution, or wire acknowledgements.

I traced `processInboundEdielMessage`, `applyCanonicalRuntimeDecision`, the actual canonical registry/runtime and own-source reading loader, `applySupplyMarketSource`, `createOrUpdateInboundProdatCase`, its physical parser/customer matching/CAS/reread, and `createEdielMessageEvent`. I also checked the existing SQL cause and own-object partition source: `20261001004331_ediel_regulated_supply_ground_archive_review.sql` has the precise already-executed C/Z24 refusal, and `20261001043234_ediel_prodat_supply_own_effect_partition.sql` transports the own scope's refusal into a held partition. The later national rescission wrapper delegates this Z04 path. SQL was read, not executed; the finite RPC result is explicitly modeled, including its top-level result fields, rather than a captured PostgreSQL result.

## Strengths

- The test calls the real coordinator and real case/event writers. The lower RPC port checks exact company/source/actor, immutable raw hash, and accepted syntax/application/function and own-object application facts before returning its declared compensation-held partition (test lines 70–77). A generic early admission hold cannot satisfy these checks or the required supply-call/warning/case assertions.
- The source fixture changes C/Z24 wire, physical customer input, and synthetic reception before immutable SDK installation. The actual C own-source reading loader enforces the Handbok26B effective-date guard; Oct13 reception is legitimate modeled input. The guard, old helper defaults, private token issuance/decoding, canonical grammar/policy, and source readers remain production code. Parsed foreign customer/point/original/date hints do not replace the physical source in the saved case (lines 139–161).
- The real supply decoder feeds the coordinator's `domainObjectCount` path. The test requires the real source-bound pending case and validated warning with own caseId/company/message/actor, complete physical held scope, exact compensation reason, `applied:false`, no committed receipts, and review required. It checks source identity/raw/hash and nonempty own/foreign business graph preservation, ordering of supply evaluation before case insertion, and fail-if-called ACK/workflow/activation controls (lines 124–135).
- The finite query store applies actual filters and re-evaluates them after an injected race. Replay checks one case and actual company/id/status/updated_at CAS filters; applied/approved/rejected/objectApplication reviews are preserved. Lost CAS reaches the real scoped reread and retains a terminal decision, while an undecided competing payload and a foreign returned case fail with precise production errors (lines 154–195).
- The warning-storage error check reaches the actual case and event writers. It expects the original error and acknowledges the already-inserted modeled case; it does not invent transaction-wide rollback or durable warning (lines 196–202).

## Issues and calibrated limits

No confirmed critical/important issue or style-only approval gate was found. The model's single-row terminals and fixed synthetic IDs are sufficient for the reached zero/one-row fixtures and sequential replay/CAS checks. They do not emulate PostgREST duplicate-cardinality errors, a PostgreSQL uniqueness race, timestamp triggers, RLS, durability, or transaction semantics. Those limitations are consistent with the checkpoint's explicit unique-index/native exclusions; no such evidence is credited here.

The technical endpoint is a declared null port, while final ACK/outbox, workflow, and activation sinks fail if invoked. Absence of those calls proves the finite consumer's lack of those downstream calls under these inputs; it is not CONTRL/APERAK execution or authentic transport proof. The modeled supply refusal is an input premise. The new test proves its actual consumer consequences, not native eligibility for that refusal or completed operator compensation. Source/company/status guards and terminal retention are actual code observations against declared modeled rows, not authenticated operator actions.

## Evidence preservation and applicability

The qualification JSON at `/tmp/ediel-z04c-6f94-source-qualification.json` has SHA256 `18a7064508c666f11f6d1abb0f9b75d8d227f5f15798ae7564f447c2e8d4393d` and is embedded verbatim. Its nine original execution-metadata records match the saved originals. All 25 indexed artifact records have matching recorded byte counts and SHA256 values and exact fenced embedded bytes, including empty outputs: 20 stdout/stderr files including the diff-check pair, and five controller/config/first-source artifacts. The two earlier applicability/availability originals are also preserved verbatim, at SHA256 `34b346edbd515fc8e9108df8862d93783f3c0deda9185402692b8889dcdbcb2f` and `a83374509b92ada6ecf7d65d665b3a3a4cba56147082bb66ab74a1af087df249`.

The recorded final run is the first green 10/10, exit0, Node22.23.3/Vitest4.1.9, bound to the exact final test SHA. Original final stdout is 240 bytes, SHA256 `255f4a00b1e1e272a8b702e4c7d96eae82d981a8419518f0d32baba12c48f936`; stderr is empty, SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Final one-file lint and focused strict TypeScript metadata also bind this same SHA and show exit0/empty outputs. The focused controller extends the real test configuration, changes only incremental/include, and retains strict/noEmit; no source/compiler gate was weakened. I did not rerun any of them.

The first unsupported CLI attempt, same-value tenant-patch port mistake, inherited pre-Oct1 reception, and guessed absent agreement-reference assertion are retained as scaffold/fixture errors. Their original outputs agree with those descriptions. The final source expects the actual missing agreement reference to be null and constructs Oct13 reception before SDK birth. These are not product RED/fix evidence, and no artificial failing product test or source feature fix is claimed.

I verified all ten recorded unchanged dependency pins against final H1 and actual base: coordinator `e617ce5f322e220b8fec7448fc2e9faec33710be6cdb65b86d8a5f763d283e4f`; case writer `39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f`; db writer `572c45939c691fa8e9610b783273fbc84340175beea0bbb683a57114e9082ece`; supply decoder `584e51953ca5da03ad9d216ce8e0e88cc09720b5dd1e7e8f6bcc7e4ec5995829`; canonical runtime `d0f6be4c7fc8b84d5c1fccc43896bc5fd376e0b8c92e30d3b96452e1a14e11b3`; own-source reading loader `bd861f45da5473fcac478bb1d604b40ede08f82bee34b96a1bbf12a80407e504`; reading fixture `ff0353dc388465fb901ed9b9bb475ed9d5bafc4ecbbd392ee241a4963ea1f327`; adapter `fc4d5d8cd7f6a7398e6d498a092280dca1d9a1b4e4bdc3fd33ad8dce333c18ed`; owner fixture `5074fabfff69b734dd30480e957acd02e88107e8506fbf7111da0c2a4708c7c8`; package lock `8bf0aca13c2f57d92db355bda81f38e526b3bd50a33db7859d272daad8d9f5c5`.

Frozen rule/acceptance registers and ledger are byte-identical to base, SHA256 respectively `48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8`, `e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10`, and `7266ee57be5ac633ec0e8ca3f169aaf7d048da45ca0abfc6004284eae75c822e`. Actual base counts 119 VERIFIED +204 PASSED=323/352. AT-Z04C remains NOT_EXECUTED/evidence empty; the new file has no whole-ID masterplan approval tag and adds zero ledger credit. The earlier 320-value originals are explicitly historical; base95d→d798 changes only the four existing proof/checkpoint/archive/ledger paths. I did not open the native archive or collect its originals.

## Recommendation and remaining ownership

Accept this exact two-file component for bounded source handoff. The implementation matches the authorized one-file consumer assertion plan for already-existing behavior; no product fix, policy gate, SQL write, existing assertion weakening, or new producer is introduced. Source/custody handoff and publication remain root actions, subject to the exact receipt and independent final-version reviews; this reviewer performed neither.

The existing qualified owners retain native/backend/GEN/original collection, genuine authority, complete cancellation ordering/original correlation, actual compensating/operator execution, prescribed physical acknowledgements, current CI, whole-ID/ledger qualification, and normal main merge. Existing genuine source proofs may be reused only with explicit applicable source/environment binding. No private ROOTf8/795 material, native logs/archive, external provider input, or current CI was fetched or executed in this review. **Ready for source handoff: yes, SOURCE_APPROVE. Whole-contract/native/merge readiness: not established by this component review.**
```

</details>

<details><summary>ediel-z04c-6f94-final-review-b-0e77d955.md — SHA256 2bb9f12a91e4d504aea735c7ccea535d868db47af539d664e4fabc16a4b1122a</summary>

```markdown
# Independent final source/evidence review B: Z04C finite compensation consumer

**SOURCE_APPROVE** for the complete two-file component at exact H1 `0e77d95531f9a01a37212ef8f2731b482e4a766f` / tree `301ae77579de8aee8d015909dde841227107dbdc`. No confirmed source or evidence must-fix was found. Approval covers the prepared finite consumer and its truthful evidence boundaries, not whole AT-Z04C acceptance or native delivery.

Reviewer `/root/fg_final_review_b` is a noncoauthor of this new component's source, fixtures and executable proof. I did not consult another final reviewer or coordinate findings. Only this original `/tmp` report was written. No tests, native/backend/SQL/GEN/current CI/log collector, private ROOTf8/unpublished795/original/artifact fetch, repository/ref write, PR or publication occurred.

## Exact whole-version binding

| Identity | Verified value |
| --- | --- |
| Workspace | `/workspace/ediel-z04c-compensation-case-20261013-6f94` |
| Full H1 head | `0e77d95531f9a01a37212ef8f2731b482e4a766f` |
| Full H1 tree | `301ae77579de8aee8d015909dde841227107dbdc` |
| H1 ordered parent | `[e627eb13d09bbdaa8e7850be9113f371e18184f6]` |
| One-file code source/tree | `e627eb13d09bbdaa8e7850be9113f371e18184f6` / `855ca9157f3ba9a5e9ab80219d6b88ed2b6d4ae0` |
| Code ordered parent / source and actual-main base | `[d798eb36f35cd4f437d44c8d234b4dbb81adc7a6]` |
| Actual-main base tree | `e3b6c11677a2b871a128504f1616def7d22dba1e` |
| Actual-main ordered parents | `[95d8d160491e79b172342654d8dc643346758105, fba453cc7cc9de8a26ec75d29248e1733316fcd1]` |

| Entire reviewed new file | SHA256 |
| --- | --- |
| `__tests__/ediel-z04c-compensation-case-consumer-6f94.test.ts` | `1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2` |
| `.agent-memory/ediel-z04c-compensation-case-20261013-6f94-checkpoint.md` | `88faf28a37a9dd0586ab1ba1fdd7e61820e359b0389d0e9c35b6fbd235dbc4a1` |

The test is exactly202 lines, mode100644, blob `3870580e726a56d01367fa6dd19730621e0d63da`. The checkpoint is183083 bytes/3040 lines. The tracked worktree is clean, HEAD is H1, and inspected file hashes match the committed version. Diff from actualbase contains exactly the two ADD paths, 3242 insertions, no deletion. No runtime, SQL, helper, config, types, frozen requirement, existing assertion or ledger change is included.

Custody is the supplied separately authenticated helper receipt `359d27a100e3f5de4992e5abd921060c85988ae4`, CLAIM6149092334, IDs EMPTY, one exact test resource `file-d3f2acb77bb1d7a3c265a2a1bb5fd8b4e24e89effed813b956b22aa1bae4ae34`, sole writer `/root/z06fg_requirements`; root wrote only its unique checkpoint. Remote receipt/ref authentication remains attributed to the existing owner/writer. No native/GEN/backend/original producer or whole-ID custody is inferred.

## Frozen requirements, skills and actual scope

Read the literal frozen AT-Z04C-SUPPLIER and its TEN-05/P-01/ENV-06 requirements. It requires supplier23-DDQ-PRODAT, Z04/Z24, own CONTRL/applicable APERAK, correct confirmed/future-period cancellation and controlled compensation for an executed effect, preserved original/cancellation order and bounded cancellation-before-original correlation without arbitrary activation, with wrong role/direction/R-D/correlation/mutation prohibited. Both copied checkpoint contract objects match the frozen register exactly.

Acceptance SHA256 `e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10`; rules SHA256 `48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8`. Actual d798 coverage SHA256 `7266ee57be5ac633ec0e8ca3f169aaf7d048da45ca0abfc6004284eae75c822e`; AT-Z04C remains NOT_EXECUTED with empty evidence, and this component gives +0. Existing323/352 ledger credit belongs to prior delivery, not this source packet.

Repository AGENTS/current start, workflow/reservations and current memory govern the read-only reviewer scope. The relevant installed code-review/differential-review/find-bugs, spec-to-code, false-positive verification and verification-before-completion approach applies, with Supabase guidance for the declared SDK/storage boundary. Their unchanged bytes from95d permit retained instruction applicability. Broad repository audit/scanners, UI/performance, implementation, producer/delivery and unrelated skill groups have no trigger in this bounded new finite assertion review.

This is a new independent component review. Earlier FG/Z09 approvals do not approve these bytes or supply acceptance credit. The existing product feature is already present; this packet composes the actual C/Z24 caller with actual case/event writers instead of introducing product behavior or claiming an artificial product RED.

## Actual call chain and test semantics

**Valid C/Z24 reaches the intended caller.** Test lines139–152 construct counted synthetic own PRODAT from the unchanged fixture, set physical223 toZ24 and UD to valid own national identity, and set synthetic receipt/context clocks to Oct13 before installing the immutable SDK fixture. The physical DDQ/receiver/LI/point and ownsource hash remain real parser inputs. Cached subtypeL,1900 date, foreign customer/point/original hints are deliberately misleading. Real canonical grammar/policy, registry decoder, own-source READ token issuance and source-recording composition execute against declared lower SDK/catalogue ports. At the modeled supply RPC, lines71–75 require exact company/source/actor, recorded hash, accepted syntax/application/function and accepted own member. An unrelated pre-canonical refusal cannot satisfy the positive-path assertions.

Read `prodatOwnSourceRegisterReadingDeclarations`: actual C source qualification requires a post2026-10-01 receipt, current own stored hash/context, physical23-DDQ-PRODAT/Z04/Z24, legal supplier/reception/mail/parse scope and current actor reads before issuing its opaque token. The synthetic timestamp correction follows that existing guard before fixture birth; it changes no old helper default or product gate and is not native authority.

**The compensation cause is a modeled lower input.** Lines70–77 provide exact `z04c_effect_already_executed_compensation_required`, applied:false, no commits/effect receipts and a held partition with the actual physical object/register scope. The actual `applySupplyMarketSource` decoder validates the scope/register shape and held/applied consistency, computes fullyApplied:false and reviewRequired:true, and propagates the cause. Existing SQL defines this precise refusal only after own original/relationship qualification when the switch/period is already executed; its result is modeled here. The finite fixture does not establish the actual locked original or PostgreSQL refusal. This limitation is correctly stated in source and checkpoint.

**Real coordinator creates the review and warning.** Read `inboundProcessing` canonical admission and domain branch through owner finish, case creation and validated event. An accepted own domain object invokes the actual supply decoder once. No commits means no source-switch callback/followup; applied:false means no committed final domain ACK; fullyApplied:false means no Legacy supply projection. The owner finishes before actual `createOrUpdateInboundProdatCase`, followed by actual `createEdielMessageEvent` with own caseId, held partition, no committed effects, applied:false/idempotent:false and warning status. Test lines124–135 assert that exact payload, parent/source/company/actor attribution, lower-apply-before-case ordering, unchanged business graph/raw/hash and uncalled ACK/workflow/activation ports.

**The case derives its own physical source.** Read the actual case parser and matcher. With wire present, they select physical223,210,UD,point/agency/register/LI and ignore absent/cached scalar fallbacks. Existing own point/site/customer queries carry real company filters. The new tests require pending_review, Z04/Z24, own customer/site/internalpoint, national identity, physical start, ownLI CASE-1, one proposed object and pending_admin_review. Absent physical agreement reference is correctly asserted null, not supplied by cache or invented source. `createEdielMessageEvent` rereads the parent and supplies both message IDs/company/actor and identical payload/event_payload to the actual insert; those fields are asserted.

**Missing and terminal workflows stay separate from this handoff.** Both variants154–168 run the real caller, create one source case and precise warning while preserving own business rows and the populated foreign supply row. Workflow/activation/final ACK stubs throw if invoked and remain uncalled. This demonstrates the bounded review handoff even without an active application workflow, not an operator's actual start or completed restoration.

**Finite storage applies actual filters and CAS.** The closed table set and RPC allowlist throw for undeclared ports; allowed inserts are only cases/events and updates only message/case projections. Source identity changes are refused while identical tenant projection patches remain permissible. Actual case/event payloads are stored, not replaced with desired case return values. The port applies eq/is/in/or predicates, projections and limit; its race callback runs before CAS filtering is reevaluated. Successful fixture queries have zero/one selected row. This is not full PostgREST cardinality/error/unique-index/RLS/transaction fidelity: `.single`/`.maybeSingle` return the first selected row, order is inert, and native insert-conflict concurrency is not proved. No documentation claims such fidelity.

**Replay and operator decision preservation use the actual writer.** Replay163–167 asserts one unchanged case, unchanged graph/source and two per-invocation review warnings, with id/company/status/updated_at CAS filters. Terminal applied/approved/rejected and objectApplication decisions169–175 are retained without case writes. Lost CAS177–183 changes status/time before filtering, returns no updated row, and the actual writer rereads the same id/source/company and preserves the modeled new final decision. Changed undecided payload185–189 produces exact PRODAT_INBOUND_CASE_CHANGED without a second review warning; broken foreign read191–194 produces TENANT_CONTEXT_MISMATCH before a case update. These controls cannot pass by a stubbed case result because the writer is unmocked.

**Warning storage failure is truthful.**196–202 call the real case writer with the declared event-store42501 error. The actual error propagates after the modeled case insert; no durable warning, operator action or transaction-wide rollback is manufactured. The test explicitly preserves this partial finite-store effect rather than claiming native atomicity.

## Evidence integrity and exact applicability

Independently extracted the embedded original qualification JSON, preserving its original newline, and reproduced SHA256 `18a7064508c666f11f6d1abb0f9b75d8d227f5f15798ae7564f447c2e8d4393d`. Its code/tree/ordered parent/base/test hash match the frozen source. All25 embedded raw/controller/source/static entries independently match their declared byte lengths and SHA256 values; no rerun or raw-log reacquisition was used. Both historical support reports also reproduce their declared hashes (`34b346ed…` and `a8337450…`) and explicitly retain dated source/count context rather than substituting it for current d798.

Final first-green stdout is240 bytes, SHA256 `255f4a00b1e1e272a8b702e4c7d96eae82d981a8419518f0d32baba12c48f936`: one file,10 passed, no failure/skip, Vitest4.1.9. Captured metadata binds that fifth invocation to exact final test SHA, exit0 and Node22.23.3. Final stderr is empty, SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Final lint and focused TypeScript metadata also bind the final test hash and exit0 with empty outputs. These are author-produced finite/static results whose preserved bytes and binding I checked, not reviewer-executed or native results.

Read the preserved controllers: finite execution chooses only the new test and existing Vitest setup; no native config/backend initialization. The first controller retains unsupported minWorkers. Static controller invokes the recorded lint/type commands. Focused TypeScript extends unchanged tsconfig.tests, changes only incremental:false and include to this file, and retains strict project options and imported dependencies; no product/compiler gate is weakened. Controllers were not executed in this review.

Historical outputs preserve the unsupported CLI failure before tests, the finite port's mistaken rejection of identical tenant patch, correctly unqualified pre-Handbok Sep22 source, and a guessed absent agreement reference. Static comparison of preserved first scaffold with final source shows only accepted canonical assertions, same-value projection allowance, declared receipt-clock correction and null agreement expectation. These are scaffold/input/expectation corrections; none evidences a product defect repaired by this packet. The checkpoint states this accurately and preserves all failed original outputs.

All ten pinned dependencies independently match their declared SHA and actual d798 bytes: inboundProcessing, inboundCases, db, supplyMarketTransition, runtimeDecision, own-source reading declarations, source-reading fixture/adapter, source-owner fixture and package-lock. No existing shared assertion or source authority is weakened. The global test include already selects the new test; no config/workflow/gate change occurs.

## Remaining boundaries and verdict

No confirmed must-fix survived checking the actual guards and alternative paths. An unrelated canonical hold cannot reach the asserted accepted lower apply; a generic/malformed lower result cannot yield the required own held partition through the real decoder; cached foreign business hints cannot satisfy the case parser assertions; terminal/CAS decisions cannot pass by inventing case results; and failed event storage cannot count as a warning/operator completion.

Native source authority, real PostgreSQL durability/RLS/unique-index/CAS locks, locked exact original/period qualification, real physical ACKs, authenticated operator execution/completed compensation, cancellation-first→later-original correlation/order, and the remaining wrong-role/direction/R-D/correlation/mutation whole-card prohibitions require separately qualified existing evidence. This finite component does not claim them or start a duplicate producer. Current mandatory CI/GEN/genuine outputs and serial adoption/delivery remain with their existing owners. No new approval API or generic market/LIVE gate is introduced.

**SOURCE_APPROVE** applies to whole H1 `0e77d95531f9a01a37212ef8f2731b482e4a766f` / tree `301ae77579de8aee8d015909dde841227107dbdc` with exact code/base/ordered parents above. Native/SQL/backend/GEN/current CI NOT_RUN here; whole AT-Z04C/operator completion/cancellation-first not proved; +0 ledger/main/merge credit. Changed source/checkpoint/base/relevant dependencies require affected qualification and exact review binding. Reviewer B pauses after this report.
```

</details>


## Källpublicering och exakt fortsatt ägargräns

41 oförändrade workflows har sju pushtriggers: sex main och en tidigare separat temporär branch. Ingen matchar vår branch; inga workflow_run/repository_dispatch-kedjor finns. Källbranchen kan publiceras utan konkurrerande native-/GEN-/backend-/collectorstart. Ingen PR, dispatch, CI-rerun eller mainmerge skapas här. Originalaudit SHA256 `562a136dbd88090f2db5866f5ede33bfc4e8d0454e58d7f31b57546fafa24c90`.

```json
{
  "schema": "ediel_source_only_push_trigger_audit_v1",
  "sourceH1": "0e77d95531f9a01a37212ef8f2731b482e4a766f",
  "base": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "branch": "codex/ediel-z04c-compensation-case-20261013-6f94",
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
  "noDispatchOrNativeInvoked": true
}
```

Efter båda slutrebinds överlämnas bara en testpostbild till befintlig seriell ROOT. Mottagaren ska verifiera egen receiptbunden custody före writes; receipt359d/filed3f2 hålls tills explicit avgränsad mottagaröverlämning och matchad transfer är utförd. Root/solewriter är pausade. Detta är inget globalt unlock eller redan utförd kodadoption/merge. Alla upptagna runtime-, SQL-, helper-, GEN-, native- och collectorroller behålls hos befintliga ägare.

Efter källöverlämningen prioriteras konkreta nya retained-owner-fynd och verifierat ledig komplettering. Nytt offentligt SC031-orakelfynd6149259115 gäller vårt redan ägda F/G-testscope och fortsatt C1-owned decoder; det ger ingen rätt att skriva i decoder. Separat läsande Z04C arrival-ordertrace gäller ett annat framtida bounded assertionpaket; ingen påbörjad ny writer/producer eller whole-claim följer av detta checkpoint. Aktuell C-komponents tvåfiliga source fortsätter oförändrad.
