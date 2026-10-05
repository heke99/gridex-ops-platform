# Read-only next-profile ownership scout, 2026-10-05

Recommendation: ONE conditional new test pair, AT-Z01L-SUPPLIER / AT-Z01LK-SUPPLIER. No ID, source, fixture, native or shared-file claim is made. Allocate only after #584 integration releases the current lane and root refreshes reservations/current input pins.

## Ownership and scope qualification

Reviewed source: /workspace/gridex-ediel-at-z09f-z09g-supplier-20261005 at frozen 87cb025d37cedd0361ef3581daac73fb8b326c28. Latest reread boards: #530 through 5994207043 (195 comments), #491 through 5994197574 (454). No explicit live L/LK profile-test reservation was found. Historical namespace assessment still names "/root/matrix_projections; Z01 source prodat / intent processes / root integration"; it closes only its namespace component. That historical source ownership remains intact.

Complete open-PR inventory: /tmp/gridex-open-pr-head-paths-20261005.json, observedAt 2026-10-05T12:04:59.900Z, all 69 PR metadata and full inventories fetched, 5,357 paths, counts match, all heads rechecked after paths without change. SHA256 bbda5e647154cae09e9578b6e44904b51896c0748a208bc676fbb6f0e9146f0d. Proposed NEW path __tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts is absent from every inventory. Source paths are already present in #421/423/424; no edits to those sources or old tests are proposed. #503/Claude retain source/native/ACK/capture, #570/#586 their export/native work, #583 Z13V/14V and its announced VH precheck, #585 Z15V/VH. H pair is a retained-owner handoff (#4915994197574), not an alternative test allocation. Existing F/G work is excluded.

Frozen coverage at 87: both NOT_EXECUTED/evidence []; live main coverage file fetched again (Git blob d4af3c2edad38ba133a9839f6e2e1d43a5eff4fa) gives the same two statuses. These are metadata, not proof of absent behavior. No tests/harness were executed, dependencies installed, product/shared files changed, Git mutated or external messages posted.

## Complete frozen literals

acceptance_tests.json:2744 / :2824, supplemented by CASE-Z01L-SUPPLIER / CASE-Z01LK-SUPPLIER:

- Given, both: "SUPPLIER; Kund/fullmakt, anläggning, nätområde och avtalad tilltänkt start enligt fältprofil."
- When, both: "Behörig kontroll av kundens nätavtalsuppgifter inför möjlig start; inte obligatoriskt om korrekta uppgifter redan finns."
- Expected L: "23-DDQ-PRODAT; BGM=Z01; fält223=Z22; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering."
- Expected LK: "23-DDQ-PRODAT; BGM=Z01; fält223=Z23; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering."
- Prohibited, both: "Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas."
- rule_ids, both: TEN-05, P-01, ENV-06; frozen execution "Inte körd mot systemet".

TEN-05 condition: process determines role, not global default; on_pass DDQ supplier / DGI permission; on_failure Z14 cannot activate supply and Z04 grants no general ESCO permission. P-01 condition: explicit 74 fields+3 groups, 110 base-D cells and register overlay; on_pass real field/group/component/object/case/source identity; on_failure no field number inferred by DTM/RFF regex. ENV-06 condition: suffix-free BGM, three-character subtype in CCI Z13/CAV; on_pass base Z function plus reason, not suffixed BGM; on_failure reject wrong combination at its actual control level. Retain all these scopes.

Source custody is frozen retained extraction, not a fresh original-PDF review: P26.A rev3 electricity, manifest original SHA256 83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95. Cases cite P §2.1–2.2/2.6 and HB chapters4/10/11; rules add T §5.2.3 and SYS. Field register/source_tables give P pp13,16–19,50,54,65: Z01 supplier→DSO; 210 own-line DTM92/203; 223 Z22 versus Z23; 213 annual energy "-" for BOTH Z01 and Z02. No gas, bilateral-H or later activation grant transfers to this pair.

## Actual coupling gap

prepareAndQueueProdatZ01FromDataRequest (flow:394–421,819–832,1037–1079,1152–1164) reads own request/original first, checks prerequisites, allocates outbound intent and delegates gateway. Customer gateway (:327–450) loads stored intent, uses its four wire namespaces, calls actual renderer (:357), finalizes/links and queues exact processVariant/expectedZ02Variant (:424–442). Renderer (:80–150,156–198,203–305) consumes qualified customer/legal-party sources, actual site-process mapping, builds physical envelope and retains source-bound draft. Actual process resolver (:455–527) reads own company/customer/site/contract/switch context; variant mapper (:168–190) maps existing-site switch→L/Z22/expected L, move_in→LK/Z23/expected LK.

Existing preparation test ediel-z01-api-original-first:16,31–48 mocks gateway and exercises prior-original return only. Gateway test ediel-z01-intent-reference-gateway:11–13,31–44 mocks renderers/finalize/queue. Renderer identity suite :5–9 mocks process resolver AND the L mapper, ACK defaults and usually envelope; some cases use actual envelope but still fixed L. Actual-source-chain :4,14 and draft suite :4,16 use hand-built raw/draft rather than real preparation→gateway→renderer. Canonical-process-group regression :4–18 reads source text. TEN05 tests establish separate pure role selection, not this full producer. Therefore new actual L/LK process→physical-wire→queued-expectation coupling materially adds evidence; absence of this coupled assertion is not a defect finding.

## Minimal proposed NEW suite and limits

One parameterized file only; reuse production modules and existing declared finite IO. Keep preparation, gateway, customer renderer, process resolver/mapper, real envelope/tokenizer and date/profile logic actual. Source/native RPC, stored rows, routing/current identity, persistence and queue ports must be explicitly finite. An opaque source result should flow through its real decoder/binder; copied JSON is not native authority.

Mandatory contrasts:
1. Fresh L and fresh LK requests with distinct operation/intent/request/LI bindings. Capture actual finalized raw and queued arguments; assert UNB 23-DDQ-PRODAT, outbound Z01 (never Z01L/Z01LK), own LIN/LI, CCI Z13 + CAV Z22/Z23, exact own customer/site/grid/legal parties, same finalization→queue message ID and matching expected Z02 variant. A stale L label/response/annual-volume value in an LK request/sibling fixture must not select L, borrow its LI or emit QTY31. Preserve the sibling's bytes and values.
2. Choose requested start DAY different from site.move_in_date and request.requested_at. Renderer :42–45/:172–175 currently projects the chosen input to eight date digits; dateSegments :52–57 treats Z01 start as contractStartDate; prodatDateFields :117–124/dates :46–49 serializes date-only as physical DTM+92:CCYYMMDD0000:203. Assert physical format203 and fixed P UTC+1 DTM+ZZZ:1:805, including a summer day. A desired calendar day is not a received-confirmation instant, actual activation time or Europe/Stockholm DST authorization. Do not invent a non-midnight start promise or clock control.
3. Missing facility, missing required own source/address/identity or unsupported actual process blocks before finalization/queue. Wrong application/party/scope at a real existing gate blocks physical production; malformed stored wire references block in gateway. Capture discriminating finite writes: permitted diagnostic/preliminary request/lifecycle changes may occur, but no finalized message, queue call, supply period/current supplier/annual-value update or activation/Z03 dispatch. A fixture-returned blocked native intent establishes error propagation only, not native role/direction enforcement.
4. Qualified success is an information request with real ACK draft defaults and expected Z02L/Z02LK. No confirmed delivery/supplier/metering-state change may be inferred from queue success. Existing immutable-original replay tests already cover no remint/requeue and should be reused, not copied wholesale.

Whole-proof blockers retained with owners: authentic contract/POA/current registry source and native authorization/direction/currentness; full applicable R/D/register contrasts; actual request/case and post-send parallel watch persistence; physical CONTRL/negative or positive APERAK consumption; actual own-LI/customer/object/grid/variant Z02 consumer and its prohibition on borrowing a sibling L response or annual values; independent ready-Z03/received-Z04 and later activation. Outgoing expectedZ02Variant metadata alone proves none of those inbound effects. z01-parallel-sla-watchdog:27–58 is a finite RPC projection witness; :65–127 largely SQL/source-text checks, not actual timer or activation proof. Do not create another native fixture/workflow, change renderer/source/schema, promote whole ATs or reinterpret ACK as an activation barrier. If a required finite assertion reveals a source obstruction, hand the exact effect to its owner.

No second pair is recommended: the useful nearby ESCO/VH/H lanes already have retained owners/prechecks; adding another mock-only profile would duplicate their scope.

## Input SHA256 (frozen 87 source)

```json
{
  "docs/ediel/masterplan-v2/registers/acceptance_tests.json": "e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10",
  "docs/ediel/masterplan-v2/registers/rules.json": "48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8",
  "docs/ediel/masterplan-v2/registers/source_manifest.json": "ae5561799f6c81d78a139e4f5f82e74228bb765369fc6876668ae99ac338892d",
  "docs/ediel/masterplan-v2/registers/prodat_message_cases.json": "77c5023457d8e405d6a560b2d2515679c2d7b59bf968800f35c16070e5f8eeee",
  "docs/ediel/masterplan-v2/registers/prodat_fields.json": "e1248f8f4ec025aa5d71e3b3249ee70b6e9e0d8e0e48a4ec6f0db11e31178354",
  "docs/ediel/masterplan-v2/annex/source_tables.json": "a23e928bdbe7e4bd514df99c789482023aea1d2f70f2a26f4a7ae5c05c973728",
  "quality/audits/ediel-masterplan-v2/coverage.json": "4307875af0390036489d81ec325b698fc9270a3506bfcbaea26e61d839e768fc",
  "lib/ediel/flows/prodatCustomerMasterdata.ts": "e55251ee640d25bc93995e54eabed92bf5df8579a43a2b181521a89f695f3f81",
  "lib/ediel/intent/renderGateway.ts": "aaa06c9f2762eac28e4e7a53aba31dfeb93b8cbe549a2f2a675d728a84e1d59f",
  "lib/ediel/intent/renderers/customerMasterdataZ01.ts": "63a4dadcc251153a15fd29cf52ae65694776ad5295899d4e2c45baf35e712cb6",
  "lib/customer-operations/customerSiteProcessContext.ts": "db2b4fc94e452a221a3857240708c1891d3008fc85ec9a7e78da04309859a281",
  "lib/ediel/prodat/z01LegalParties.ts": "c3282798a5402948736452a81363a869b1ad75eb59dace27025f040745c01362",
  "lib/ediel/prodat/render/dates.ts": "25b2cd8c56b4cb7c824c6ed6c6ecc8783b8843212387f4cb08223fc157b40505",
  "lib/ediel/prodat/render/dateSegments.ts": "d89e340f6638a8633f405af3a1fc14ccb260363900caac6fe0d10f1d7e802bd8",
  "lib/ediel/prodat/prodatDateFields.ts": "5dcc9d8aff057bef42fa974f9cb3cc71da3f1b2f9e04edba3a238738420705cb",
  "__tests__/ediel-z01-api-original-first.test.ts": "1e5e65d2cfd6641b48ea6d1b7b1f142a8d6eccc1be5754b6a2414d12f4edf1ae",
  "__tests__/ediel-z01-intent-reference-gateway.test.ts": "d8dee2da68ac74182007ba1ada2cf1c2793e740016c120d5ca80d5f6e65e04a7",
  "__tests__/ediel-facility-lookup-identity.test.ts": "94fe2a4ff20abd44e14c984e964218ec563f457f685e2fe32f5aa2fa9bd1463b",
  "__tests__/ediel-customer-masterdata-actual-source-chain.test.ts": "fbf2217bdca466e43471f3f7b0453d1fed4a0c1e006b37da5f36279b57996902",
  "__tests__/ediel-customer-masterdata-draft.test.ts": "8d77f81c16a74abe3cb4ceacb3da0a56be134d66720fb1f865e1d46164b244b0",
  "__tests__/ediel-z01-canonical-process-group-regression.test.ts": "d62b51feaa37836f3d7e4d14f48ae7d5f96c57f2439d830088aab89ef3baae31",
  "__tests__/z01-parallel-sla-watchdog.test.ts": "8109db49e9370180275ee2b15ac4273888c6385b56f0a0388631f5a289983eb2"
}
```

Read-only methods: GitHub complete issue comments, search open PRs, metadata→all filenames→metadata head recheck; scoped rg/sed and JSON reads, SHA256 of inputs, git rev-parse/status. No passing test receipt is invented from these static reads. Root must repin current source dependencies before any actual next-lane assignment.
