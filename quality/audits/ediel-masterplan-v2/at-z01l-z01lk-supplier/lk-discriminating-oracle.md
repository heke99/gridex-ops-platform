# AT-Z01LK-SUPPLIER: independent read-only discriminating oracle

Prepared 2026-10-05. Source root: `/workspace/gridex-ediel-at-z09f-z09g-supplier-20261005`; independently checked HEAD `87cb025d37cedd0361ef3581daac73fb8b326c28`. Parent reports current main `498ebd` has no relevant source change; this note's authentic function/line/hash anchors are frozen 87, not a fresh audit of current main.

This is preparation only. No test was written or executed, no native harness or dependency was installed, no repository/Git/shared coverage file was changed, and no ownership claim or external comment was sent. The sole written artifact is this `/tmp` note. The conditional L/LK allocation remains subject to #584 integration and root's reservation/input refresh. This note does not repeat the other agent's L IO-boundary inventory.

## Literal and scope

`docs/ediel/masterplan-v2/registers/acceptance_tests.json:2824` and `registers/prodat_message_cases.json:93` agree:

- Given: `SUPPLIER; Kund/fullmakt, anläggning, nätområde och avtalad tilltänkt start enligt fältprofil.`
- Trigger: `Behörig kontroll av kundens nätavtalsuppgifter inför möjlig start; inte obligatoriskt om korrekta uppgifter redan finns.`
- Expected: `23-DDQ-PRODAT; BGM=Z01; fält223=Z23; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering.`
- Prohibited: `Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.`
- Attached rules are TEN-05, P-01 and ENV-06. Frozen execution says `Inte körd mot systemet`; coverage at `quality/audits/ediel-masterplan-v2/coverage.json:3075` is `NOT_EXECUTED`, evidence `[]`.

TEN-05 (`registers/rules.json:183`) selects DDQ for the supplier process, DGI for permission. ENV-06 (:483) requires a suffix-free BGM and the physical subtype reason in CCI Z13/CAV. P-01 (:543) requires explicit numeric field/group/component/object/source identities and applicable R/D/register overlays; this small oracle cannot close the whole matrix. Supplemental ENV-08 (:513) requires fixed payload standard time, while P-10 (:678) requires actual inbound Z02 correlation with LI, parties, object, grid and customer and a separate Z03 assessment. Neither expected-Z02 metadata nor ACK preparation proves those inbound effects.

The field source explicitly makes Z01 field 210 required, line-scoped `DTM+92` with format 203 (`lib/ediel/prodat/prodat26AFieldMatrix.ts:54`). Field 223 is `CCI++Z13/CAV`, first CAV component (:75). Annual-energy field 213 is `QTY+31` and **unused (`-`) for both Z01 and Z02** (`registers/prodat_fields.json:1286`, matrix :65). No new field-number inference or validator is needed.

## Actual source row selection for LK

The production renderer calls the real resolver with the requested company, customer, site and operation (`lib/ediel/intent/renderers/customerMasterdataZ01.ts:96`). It does **not** pass a contract ID. Keep both the actual resolver and `resolveProdatCustomerProcessVariant` unmocked for the proposed assertion.

| Actual selector | LK fixture requirement and discriminating limit |
| --- | --- |
| `customerSiteProcessContext.ts:468–478`: `customer_sites` by exact `id=siteLK`, `company_id=company`, `customer_id=customerLK`, `maybeSingle` | A genuine own LK site row must match all three UUIDs. A same-company sibling L site owned by another customer cannot satisfy this selector. Missing result throws `customer_site_not_found_or_wrong_scope`. |
| :481–491: `metering_points` by company/customer, either site alias equal to siteLK, creation descending, limit 20 | It picks the first active row in that ordered set, otherwise the first row. It is not selected by the request's `metering_point_id`. Ensure the fixture's actual export-context point and this selected point are the same own LK row; make sibling point identity/grid/annual data distinct. |
| :202–223: `customer_contracts` by company/customer, either site alias, status signed/active, signed_at descending, limit 1 | The renderer's absent contractId means the resolver selects the latest signed candidate, not an operation-specific contract. For the positive path provide one own signed LK contract with real-shaped signed_at and a distinct lower-priority requested day. |
| :255–275: readiness view by exact company/customer/customer_site_id/selected contract | Agreement-ready and agreement-signed must be true to avoid readiness blockers. The contract is then reread by selected ID/company/customer at :501–511 for metadata. These finite projected facts establish branch behavior only. |
| :513–524: `supplier_switch_requests` by company/customer/either site alias; eligible statuses draft, queued, validated, ready_to_send, submitted, waiting_response, manual_followup_required; created_at descending; limit 1 | The latest eligible own LK switch must be selected, with request_type `move_in`, metadata process_type `move_in`, and its own requested calendar day. A newer sibling L row must remain outside the filters rather than being removed from the fixture. |

Process derivation at :429–452 uses first supported explicit metadata in **switch → contract → site** order, then switch request_type, then site move-out/current-supplier evidence before site move-in date. `current_supplier_unknown === true` counts as current-supplier evidence. Thus merely adding move_in_date to an ordinary existing-supplier fixture does not force LK. A contradictory higher-priority L row would properly select L under this code. Use coherent own move_in metadata for the positive LK case and retain a genuinely distinct L sibling.

The actual mapper at :180–189 gives move_in → **LK / Z23 / expected Z02LK**. Unknown or unsupported process returns no usable variant (:191–198); the renderer throws that blocker at :102–104. This is existing behavior, not a proposed fallback to L.

Requested calendar day is selected independently at :630–634: selected eligible switch requested_start_date → contract readiness requested day → site move_in_date → null. Contract fallback uses requested_start_date, otherwise the first ten characters of starts_at (:282). The renderer then projects that result to eight digits and falls back to export-site move_in_date, then request requested_at (`customerMasterdataZ01.ts:42–45,172–175`). `dataRequest.request_payload.requested_start_date` is not an authoritative source in that expression.

There are two actual read paths: export context (`lib/cis/db-shared.ts:210–278`) and site-process context above. Export point selection is by the requested point ID plus company (:125–129), while process context chooses among own-site points. Export site's plain read is by site ID/company (:119–123), and ordinary tenant consistency checks company identities (:146–188); the stronger dated-structure customer/site/point check at :255–258 only applies when edielStructure is supplied, which this renderer does not supply. Do not describe the two paths as a single atomic, operation-bound source snapshot.

## Minimal positive oracle: real LK source → physical wire → queued expectation

Use valid-shaped distinct UUID namespaces for one company, customerLK/siteLK/pointLK/contractLK/switchLK/requestLK/operationLK/intentLK and a different customerL/siteL/pointL/contractL/switchL/requestL/operationL/intentL. Keep sibling L rows newer where that helps detect missing source filters. Keep all source rows byte-for-byte unchanged throughout the proposed positive and negative cases; read/query matching must obey the real predicates and ordering.

Use these deliberately different calendar values: own selected LK switch requested_start_date **2027-07-15**; own signed LK contract requested_start_date **2027-07-16**; own LK site move_in_date **2027-07-17**; own request requested_at **2026-10-05T12:00:00Z**. Put a distinct earlier/later day, L metadata and Z22 reason on sibling rows. Own/sibling meter IDs, legal customer identities and grid areas must differ. Put conspicuous annual-energy sentinels on both site's original annual_consumption_kwh fields (and stale request payload if used) so absence of inherited QTY31 is observable. These sentinels do not grant production source authority.

Use distinct persisted, validated intent wire namespaces, for example own document `LK-OWN-DOC`, own LI `LK-OWN-LI`, own UNB interchange `27071500000001`, own UNH message `1`; sibling document `L-SIBLING-DOC`, LI `L-SIBLING-LI`, interchange `27071500000002`. Stale caller document/LI and request payload L/Z22 must differ from the own persisted values. These are deterministic mechanical references, not authentic immutable transport receipts.

Run the existing consumer path in the eventual test: the existing real customer-masterdata preparation/gateway calls the existing real renderer, resolver, mapper, PRODAT policy/profile/date/serializer path. Finite external source and persistence ports remain explicitly declared by the other agent's boundary report; do not replace the real resolver with a hardcoded `{processType:'move_in'}` or mock the mapper to LK. The intent must be a fresh own validated intent with no established edielMessageId, so existing-original replay correctly remains outside this new assertion.

The smallest discriminating assertions are:

1. Actual own resolver result is processType move_in and requestedStartDate 2027-07-15. Recorded query selectors include the exact company/customer/site and real eligible-state/order limits above. No generic table-only mock may return the sibling row regardless of filters.
2. Tokenize the actual produced EDIFACT bytes using the existing codec/tokenizer. Require UNB application reference `23-DDQ-PRODAT`, own UNB interchange and own UNH; suffix-free BGM `Z01` with own document; own LIN object and own `RFF+LI:LK-OWN-LI`; physical own-line pair **`CCI++Z13` then `CAV+Z23`**, never sibling Z22. Check the selected object's grid/customer data rather than relying on a global substring alone.
3. Exactly one own-line field 210 is **`DTM+92:202707150000:203`** and the header has **`DTM+ZZZ:1:805`**. Its strict fixed-offset inverse is **2027-07-14T23:00:00.000Z**, even in summer. The expected value is independently pinned from the source calendar day; do not calculate the expectation through the same render helper being tested. Europe/Stockholm summer midnight would imply a different instant and is not the P payload rule. The renderer's digit/date projection is not a promise to preserve a non-midnight ISO instant. UNB local creation time is a separate rule and need not be asserted as the contractual start instant.
4. No QTY with qualifier 31 appears in any actual Z01 object/register scope. This proves that this customer renderer does not inherit those annual sentinels, not that arbitrary direct register-renderer input can never serialize a forbidden value. The generic register serializer can emit annualConsumption (`render/registers.ts:8–16`); matrix validation remains a separate existing control.
5. Actual draft parsed/validation projections are `prodatVariant:LK`, `reasonForTransaction:Z23`, `expectedZ02Variant:LK`, `canonicalProcessType:move_in` (`customerMasterdataZ01.ts:261–265,284–286`). The real gateway's actual queue-call payload is processVariant LK and expectedZ02Variant LK (`renderGateway.ts:424–442`), bound to own request/intent/operation/message. Assert that actual captured argument, not a fixture's invented returned queue success.
6. Permitted information-request/message/link/lifecycle/queue effects remain own-scope. Compare retained sibling source bytes, original messages/references and annual fields before/after. No site/current-supplier/supply-period/annual-value/activation/Z03 effect may be inferred from this queue result. The finite write assertions can show those effects absent in the observed declared port trace only; they cannot certify unexecuted native side effects.

Authentic renderer anchors: own source/variant :80–105; start and reason :172–185; actual physical envelope/transport namespace :203–217; own persisted identities/scope :248–277. `z01WireReferencesFromIntent` (`lib/ediel/prodat/z01WireReferences.ts:21–27`) consumes the validated intent and checks reference shape. Actual profile renderer retains exact Z01 LI (:201–202,307), builds own LIN (:230–236), and chooses physical subtype from canonical policy (:205,241–242). Dates are line/header scoped by `dateSegments.ts:73–84`, rendered through `prodatDateFields.ts:117–124`; `dates.ts:42–47` maps a calendar day to 0000, :80–85 inverses with fixed UTC+1.

## Concrete existing wrong-binding refusal

Keep the company and **customerLK** unchanged, but use **siteL belonging to customerL** in a cloned attempted LK data request. Keep both valid source sites, all sibling contract/switch/point/annual rows and original sibling wire namespaces unchanged. Use the real predicate-respecting source reads. Do not simulate an invalid database by returning siteL as if it matched customerLK.

The actual resolver receives (company, customerLK, siteL). Its `customer_sites` query :468–474 cannot match any row, and :477–478 throws **`customer_site_not_found_or_wrong_scope`** before the meter/contract/switch reads. This can be observed directly at the real resolver; in the coupled renderer/gateway path the same exception occurs after valid customerLK export/actor/source preparation. Plain same-company export reads can pass that earlier stage; this is why the precise resolver gate matters. If authentic source preparation independently holds first, report that actual earlier obstruction rather than manufacturing native approval just to reach this line.

Gateway :353–370 calls the renderer before finalization. Its :453–464 catch classifies the exception, marks the intent render failed, and returns blocked/message null. Require the actual error propagation plus zero finalized message/link/message-update/queue calls for this attempt and no observed supply/annual/Z03 mutation. Permit its diagnostic failed-intent lifecycle write; do not assert that every write count is zero. Retain sibling source rows and original byte namespaces byte-for-byte. This is a precise same-company wrong-customer/site rejection, not a general claim that all wrong LI, request, meter or operation bindings are refused.

Alternative existing tuple refusal, if needed after the main oracle: actual legal-receiver check in `z01LegalParties.ts:15–21` rejects a registry dispatch source with a different route/profile/environment/family/technical receiver/subaddress/application/legal tuple. The exact registry-source custody/native qualification belongs to its retained owner. A finite returned source tuple and its rejection establishes consumer guard behavior only.

## Independent refutation and retained limits

- A site with only move_in_date can still resolve L because explicit L metadata, a switch request_type switch, current-supplier fields or current_supplier_unknown true have higher priority. That refutes a naive LK fixture.
- **operationId is not a row selector in this resolver.** It is returned as evidence at :638; latest eligible same-site switch selection can cross an operation boundary. Do not invent an expected `operation mismatch` blocker for this new test or silently add one. Any actual obstruction goes to the existing source owner.
- The renderer consumes processType/requestedStartDate, not siteProcess.blockers/readiness booleans. Missing contract/authorization/native registry readiness must not be described as renderer-level hard rejection merely because the resolver collected blockers. Current native intent/finalization rules and authentic source evidence are separate retained proof requirements.
- Preserved reference format and queued expectedZ02Variant do not prove actual LI/party/object/grid/customer Z02 correlation. Original replay already has dedicated tests; do not duplicate replay/namespace/native validators or harnesses here.
- The outgoing Z01 date denotes an intended calendar start for information lookup. It is not received Z04 confirmation, a canonical confirmed supply period, an activation instant or an activation authorization. Neither positive APERAK nor expected Z02LK is a delivery start barrier/approval.
- Full role/direction/current actor authorization; authentic contract/fullmakt/registry/customer source custody; all R/D/parent/register contrasts; actual post-send parallel watch; physical CONTRL/APERAK intake; own Z02 consumer and annual-value nonmutation; subsequent Z03/Z04 and activation remain unproved in this note. Preserve owners and whole-AT status.

Ownership comes from root's retained scout, not a new board claim: historical `/root/matrix_projections; Z01 source prodat / intent processes / root integration`; #503/Claude source/native/ACK/capture; #570/#586 export/native work; existing P/U validators and registry/customer source owners; original source/intent/namespace owners; actual inbound Z02 and later activation owners. No transfer, new native source/harness, production fix or acceptance promotion is proposed. If the real consumer cannot reach these assertions with existing authentic fixtures, record the exact source/native obstruction and hand it back through root/retained coordination.

## Independently measured SHA256 anchors

All paths below are relative to the frozen source root above. These are file-byte hashes, not Git blob IDs or runtime receipts.

```text
db2b4fc94e452a221a3857240708c1891d3008fc85ec9a7e78da04309859a281  lib/customer-operations/customerSiteProcessContext.ts
289de6560100e5d6b2b8db620dfc093228fa62c5460b9e71b64fe5cc5bc351c2  lib/cis/db-shared.ts
ff6a2521f1ac31661ca47d87144f8f9c683638a417990321c79ca3d7c69f7e8b  lib/ediel/production/customerMasterdataSource.ts
63a4dadcc251153a15fd29cf52ae65694776ad5295899d4e2c45baf35e712cb6  lib/ediel/intent/renderers/customerMasterdataZ01.ts
aaa06c9f2762eac28e4e7a53aba31dfeb93b8cbe549a2f2a675d728a84e1d59f  lib/ediel/intent/renderGateway.ts
7d5eff3c51ecb817a1378d55e5821dc437017e41849bb256671d15db16471c95  lib/ediel/prodat/builders/profileRenderer.ts
9725507394ab36a27a5152977e61f05ea90decf268b43401b432ab7f5dbab2f6  lib/ediel/prodat/z01WireReferences.ts
c3282798a5402948736452a81363a869b1ad75eb59dace27025f040745c01362  lib/ediel/prodat/z01LegalParties.ts
25b2cd8c56b4cb7c824c6ed6c6ecc8783b8843212387f4cb08223fc157b40505  lib/ediel/prodat/render/dates.ts
d89e340f6638a8633f405af3a1fc14ccb260363900caac6fe0d10f1d7e802bd8  lib/ediel/prodat/render/dateSegments.ts
5dcc9d8aff057bef42fa974f9cb3cc71da3f1b2f9e04edba3a238738420705cb  lib/ediel/prodat/prodatDateFields.ts
a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382  lib/ediel/prodat/prodat26AFieldMatrix.ts
522f50623554a41bab738f3ded72bad2a37e997c6039a6b08bc4f51556a5d9c5  lib/ediel/prodat/render/registers.ts
e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10  docs/ediel/masterplan-v2/registers/acceptance_tests.json
77c5023457d8e405d6a560b2d2515679c2d7b59bf968800f35c16070e5f8eeee  docs/ediel/masterplan-v2/registers/prodat_message_cases.json
48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8  docs/ediel/masterplan-v2/registers/rules.json
e1248f8f4ec025aa5d71e3b3249ee70b6e9e0d8e0e48a4ec6f0db11e31178354  docs/ediel/masterplan-v2/registers/prodat_fields.json
```

Source qualification: original PDFs were unavailable to this child review. Literal/case/field/rule checks used frozen repository material. Scout names P26.A revision 3 electricity source SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`; that original PDF hash was not independently recomputed here. Proposed oracle is useful bounded new consumer evidence, not a discovered production defect or a whole-ID completion receipt.
