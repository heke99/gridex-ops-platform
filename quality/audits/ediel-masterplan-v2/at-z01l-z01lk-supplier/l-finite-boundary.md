# Z01L finite IO boundary blueprint

Read-only preparation, 2026-10-05. This document defines only the L contribution to ONE future preparation → stored-intent gateway → actual customer renderer → physical wire/persistence/queue suite. It neither allocates that suite nor executes it. LK sibling, date-selection and source-distinction cases belong to the separate LK preparer. Root must recheck ownership and repin after #584 integration before assigning one fresh writer. Source/native/renderer/old-test owners retain their files.

Analyzed worktree: `/workspace/gridex-ediel-at-z09f-z09g-supplier-20261005`, HEAD `87cb025d37cedd0361ef3581daac73fb8b326c28`. The parent supplied the current-main `498ebd` no-change qualification; all source anchors and hashes below refer to frozen 87. Paths below are relative to that exact absolute worktree. The scout is `/tmp/gridex-next-profile-ownership-scout.md`. No test, dependency installation, repository/Git mutation, external comment or authority receipt was produced by this preparation. The only created file is this blueprint.

Skill routing: writing-plans supplies decomposition and full-e2e-verification supplies explicit boundary/outcome limits. The parent expressly requests preparation only and `/tmp`; their normal implementation/execution/commit/delegation instructions are not activated. This is neither a production E2E verdict nor a native Supabase execution receipt.

## Complete L requirement and frozen source custody

`registers/acceptance_tests.json:2744` under `docs/ediel/masterplan-v2`:

- Given: “SUPPLIER; Kund/fullmakt, anläggning, nätområde och avtalad tilltänkt start enligt fältprofil.”
- When: “Behörig kontroll av kundens nätavtalsuppgifter inför möjlig start; inte obligatoriskt om korrekta uppgifter redan finns.”
- Expected: “23-DDQ-PRODAT; BGM=Z01; fält223=Z22; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering.”
- Prohibited: “Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.”
- Rules: TEN-05, P-01, ENV-06. Layer: “Planerat meddelande-/rollprov”. Execution: “Inte körd mot systemet”; evidence empty.

`registers/prodat_message_cases.json:3–18` independently fixes CASE-Z01L-SUPPLIER to outbound PRODAT Z01/L/Z22, SUPPLIER, 23-DDQ-PRODAT, the same permitted effect and full `prodat_fields + prodat_conditional_cells + parent_group + register_overlay` profile, citing P §2.1–2.2/2.6 and HB chapters 4/10/11.

Full rule records were read. TEN-05 (`rules.json:183–196`) selects role from the business process, DDQ for supplier and DGI for permission; Z14 must not activate supply and Z04 must not grant general ESCO authority. ENV-06 (`:483–496`) places suffix-free function in BGM and three-character subtype/reason in CCI Z13/CAV, rejecting invalid combinations at their actual control level. P-01 (`:543–556`) requires 74 numeric fields, 3 parent groups, 110 base-D cells and explicit register overlay, with actual field/group/component/object/case/source identity rather than inferred field numbers.

L-applicable R fields in the full frozen field register: 311,312,202,203,205,206,207,208,314,209,210,223,260,261,226,227,228,231,232,316. D fields: 229,233,234. Group UD is R; IT is O and its children become required only when selected; IV is “-” (`prodat_parent_groups.json:3,28,53`). PC-229-Z01 requires available end-user address in active UD; PC-233/234-Z01 require their selected IT parent (`prodat_conditional_cells.json:654,822,858`). Unknown own-send facts stop sending; an inactive parent makes child R/D inapplicable. The proposed fixture supplies a complete UD address and complete optional IT data so these actual applicable checks execute. This small suite does not discharge every register/overlay counterexample.

Specific physical anchors: field223 Z22 at `prodat_fields.json:1805`; field260 own grid area is **RFF+Z05**, not LOC (`:2480`); field261 authorization reference is RFF+ANJ (`:2684`); field226 own LI is RFF+LI (`:2735`). Field213 annual volume is “-” for both Z01 and Z02 and belongs to SG12/QTY31 (`:1286`). A stored annual-volume sentinel must remain unchanged and must never become QTY31 in this Z01 producer.

Original P26.A rev3 electricity PDF custody is the retained manifest hash `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`; this is a frozen extraction review, not a fresh PDF review or permission to extend to gas, bilateral H, native ACK or activation.

## Actual path and the keep-real contract

1. `flows/prodatCustomerMasterdata.ts:394–425` reads own request, own original history and grid owner. Use a fresh original absence, not a replay case. Supply explicit `environment:'test'` and existing communication route to avoid unrelated route/environment materialization (`:472–583`). An existing own preliminary outbound with no Ediel original is the smallest fixture; real `shared.findOrCreateDataRequestOutbound:160–225` reads/reuses it, preserving distinct document and LI references.
2. Keep `resolveDecisionBackedOutboundContext` real (`flows/routeDecisionContext.ts:68–178`). A finite route decision/current canonical context may be supplied below this wrapper as explicitly declared routing IO; the wrapper's application-reference/version consistency remains actual. These supplied route facts cannot prove native current actor/issuer/route authorization. Do not replace the whole preparation function or make its gateway return a canned receipt.
3. Keep real prerequisites (`customer-operations/z01Prerequisites.ts:188–291`), real reference allocator and persisted-reference decoder (`prodat/z01WireReferences.ts:6–27`), real canonical version resolution (`core/versionRegistry.ts:204–214`), real intent validation/upsert (`intent/intentEngine.ts:132–299,341–426`) and actual gateway (`intent/renderGateway.ts:327–466`). The preparer passes outbound explicitly and live prerequisite facility evidence into its intent (`flows/prodatCustomerMasterdata.ts:1037–1085`).
4. Keep actual `getCustomerExportContext` (`cis/db-shared.ts:210–278`) and customer/site tenant consistency, actual customer-life-event decoder, actual native customer-source decoder/WeakSet (`production/customerMasterdataSource.ts:9–36`), legal sender/receiver checks (`prodat/z01LegalParties.ts:7–21`) and both immutable registry DTO decoders (`actor-registry/registryMarketSource.ts:9–17,36–54`). Mock only their table/RPC IO, never export-context/source-reader functions returning allegedly branded objects.
5. Keep actual site-process resolver and mapper (`customer-operations/customerSiteProcessContext.ts:168–199,429–647`). Own `supplier_switch_requests.request_type='switch'` with empty switch/contract/site metadata selects `supplier_switch_existing_site` and L/Z22/expected L. Do not mock either resolver or mapper to return L. Use an exact company/customer/site signed contract/readiness and applicable POA/document/scope facts; source readability does not establish issuer authority.
6. Keep actual customer renderer (`intent/renderers/customerMasterdataZ01.ts:80–218,219–306`), PRODAT engine (`prodat/engine.ts:127–181`), profile builder (`prodat/builders/profileRenderer.ts:190–365`), field/date/profile policy and real envelope/preflight/tokenizer. Rendering uses `mode:'production'` even on a test-environment route (`renderer:135–139`), so national field failures must not be downgraded with test-mode mocks. Date functions stay real, without adding an L date-selection contrast owned by LK.
7. Keep the **exact returned draft object** through `rememberCustomerMasterdataDraft`, gateway's intent assignment and `shared.finalizeOutboundDraft`. Real WeakMap binding at `prodat/customerMasterdataDraft.ts:10–21` and `flows/shared.ts:264–266` pairs actual bytes, customer/company/environment, intent and route with the real qualified projection. A spread/JSON clone or wholly mocked finalizer loses this boundary. Real `core/kernel.finalizeCanonicalOutboundDraft:582–743` performs canonical source-bound validation (`:694–700`), fresh registry checks (`:701–702`) and owner-witness response validation (`:719–720`) before persistence.
8. Keep real message persistence/link/status, business-reference/event writes and real queue adapter (`db.ts:373–554,739–763,886–947`; `flows/shared.ts:269–319`; `outbox/createOutboxItem.ts:53–145`). Observe finite table mutations below those adapters. Gateway binds intent/profile/operation at `:398–414`, then queues the actual same message ID plus parsed L/expected-L metadata at `:424–442`. Stop at outbox creation; no sender, provider, ACK consumer, timer or activation call is part of this suite.

## Minimal finite IO inventory

Every row set must enforce actual query filters/order/limits and exact mutation identity, not return the first row regardless of predicates. Unexpected RPC names or writes fail the fixture. Independent fixed synthetic source records are input; production decoders, frozen policy and source binders decide whether they qualify.

| Finite port | Required data and discrimination | Actual consumer/anchor |
| --- | --- | --- |
| Request/original/preliminary outbound reads | Own `grid_owner_data_requests` with scope customer_masterdata; own `outbound_requests` keyed by company/source request/type/operation, no response message; `ediel_messages` original lookup empty. Existing outbound has its own route and BGM reference distinct from request's LI reference; no terminal/sent receipt. Optional `customer_info_requests` only when an explicit request ID is present. | `flows/prodatCustomerMasterdata.ts:403–425`; `prodat/z01OriginalReplay.ts:39–63`; `flows/shared.ts:160–198` |
| Routing/current canonical context IO | Finite `resolveEdielRoute` decision and `resolveCanonicalOutboundContext` route facts below actual routeDecisionContext; exact own company/route/profile/environment, DDQ application, legal sender separate from UNB sender; receiver separate legal/technical identities. Declare these functions as routing IO, not an actual router/native-identity proof. Preparer additionally reads verified `platform_actor_routes` and `company_market_party_routes` where reached. | `flows/routeDecisionContext.ts:89–172`; `flows/prodatCustomerMasterdata.ts:332–375,684–703`; actual legal checks remain real |
| Tenant/operational reads | Own active/accepted `company_memberships`, own active `user_profiles`; `gridex_actor_has_company_permission` only for exact actor/company and reached permissions (original read-any-of communication.read/metering.read; communication.write). Own operational `companies` for real outbound prepared update. | `services/authorization.ts:18–38`; `prodat/z01OriginalReplay.ts:40`; `cis/db-outbound.ts:575–577`; `tenant/governance.ts:551–565` |
| Customer/site/process source tables | Own `customers`, `customer_contacts` (may be empty), `customer_sites`, `metering_points`, `customer_contracts`; exact own `customer_contract_lifecycle_readiness_v`; own switch row request_type switch; own active `powers_of_attorney`, `customer_authorization_documents`, `authorization_scopes`; actual `grid_owners`, `grid_owner_contact_channels` (may be empty). Fixtures must answer both site_id and customer_site_id query forms accurately. | `cis/db-shared.ts:109–141,234–265`; `customer-operations/customerSiteProcessContext.ts:213–276,308–386,468–586`; `z01Prerequisites.ts:89–116,188–255` |
| Customer life-event RPC | `ediel_customer_life_event_export_projection_v1` for exact company/customer/actor returns finite `status:'not_applicable'` in this L setup. Do not manufacture a death-status or historical-customer grant. | `production/customerLifeEventExport.ts:26–56` |
| Qualified customer-source RPC | `ediel_prepare_customer_masterdata_v1` exact company/customer/actor/asOf/environment. Response has status authorized, exact scoped IDs/environment, same asOf instant, enumerated sourceKind, fixed synthetic sourceReference, 64-hex sourceDigest, UUID sourceContextId; identity {id,qualifier SE1/SE2,agency260}; nameParts1–2, streetParts1–3, required postalCode/city/two-letter country with actual limits. Set qualified UD facts different from mutable customer fallback values to expose whether the source was actually consumed. Return held only in the source-negative case. | `production/customerMasterdataSource.ts:9–36`; actual immutable brands/address ownership at `prodat/customerMasterdataAuthority.ts:8–39,44–57` |
| Immutable legal receiver source RPCs | BOTH `ediel_registry_dispatch_source_v1` and `ediel_registry_route_source_v1`; exact company/communicationRoute/profile/environment/PRODAT/DDQ dispatch and source route UUID. Both have matching EL market, actor/source hashes/legal party/wire JSON. Source wire family/environment/subaddress/appref/address/transport/legal party/interchange party must match configured route; legal DO may differ from UNB receiver. Never bypass actual nested source read at dispatch decoder line45. | `actor-registry/registryMarketSource.ts:9–17,36–49`; `prodat/z01LegalParties.ts:15–21`; kernel fresh checks |
| Canonical rule-pack read RPC | `resolve_canonical_ediel_rule_pack_with_witness_v1`: exactly electricity/PRODAT/Z01/L/outbound/current accepted business date. Configured synthetic activation row carries UUID pack/profile, guide26.A/r3, E2SE6A, effective dates, profile family PRODAT/messageCodeZ01/transactionSubtypeL/canonicalDirectionoutbound/reasonZ22, required ready flags and original version/snapshot with internally consistent pack/profile/hash. Preserve real normalization and source comparison. Do not use a Z04 activation row unchanged or make the decoder return fabricated canonical output. | `rulebook/canonicalRulePackRegistry.ts:158,299–361,399–443`; `rulebook/validator.ts:599–610,678–702` |
| Ordinary outbound owner-witness RPC | `ediel_prepare_outbound_owner_witness_v1`: actual fixed company/actor/test and actual generated bytes, exact original evidence from canonical validation. Configure one fixed **synthetic** witness/evidence; assert input matches configured scoped wire/profile facts and independently configured evidence, never silently accept all caller evidence. Return version1, UUID witnessId and exact evidence/snapshot identity required by real decoder. No source-qualified positive/negative fixture IDs, bilateral owner or certification run. This finite response tests response consumption only; native sealing/issuer authority remains unproven. | `core/outboundOwnerWitness.ts:6–26`; `core/kernel.ts:711–743` |
| Persistence/queue table IO | On success: insert actual `ediel_messages`; exact own link/status patches; upsert `ediel_business_references`; insert `ediel_message_events`; upsert `ediel_outbox` keyed by lock_key; real own `outbound_requests` status/response and `outbound_dispatch_events`; actual intent upsert/lifecycle and `grid_owner_data_requests` diagnostics. Record all operations and stored bytes/IDs, with no implicit success row for unlisted tables. | `db.ts:373–554,739–763,886–978`; `outbox/createOutboxItem.ts:53–145`; `intent/renderGateway.ts:386–450`; `cis/db-outbound.ts:557–638`; `cis/db-data.ts:462–502` |

Not needed for a fresh ordinary queued L: customer masterdata persisted-message-basis/recovery RPC; death-status/certification fixture registration/prepare RPCs; bilateral original RPC; source-rule-pack capture for a later inbound/send owner; provider transport. If a real call unexpectedly reaches one, stop and report the exact owner boundary rather than adding an indiscriminate response.

## L rows in the one future coupled suite

All rows call the real `prepareAndQueueProdatZ01FromDataRequest`; none calls the pure mapper as its only subject. Reset finite tables and logs between rows. No original-first/replay cases are copied.

| Row | One discriminating change and reached gate | Required physical/persistence oracle |
| --- | --- | --- |
| Fresh L success | Exact own request/site/meter/contract/switch/route plus qualified DTOs; point ediel_reference `735123456789012345`; `request_type:'switch'`, metadata empty. Keep actual mapper and builder. | Result prepared true; one actual outbound Z01 message inserted and same ID in outbox; persisted intent's UNB/UNH/BGM/LI match physical namespaces; tokenized UNB app23-DDQ-PRODAT, UNH E2SE6A, suffix-free BGM Z01, own LIN with agency9, CCI++Z13/CAV+Z22, RFF+LI, RFF+Z05, RFF+ANJ, separate legal NAD FR/DO, full source-qualified UD, complete selected IT. Queue payload L/expectedZ02L agrees with physical reason. Actual national/date/field/preflight checks run. No QTY31; all forbidden business rows unchanged. ACK flags come from real deriveEdielAckDefaults, not mocked booleans or an ACK-processing receipt. |
| Late facility rejection | Change ONLY highest-priority own `metering_points.ediel_reference` from the valid 18-digit value to **`73512345678901234` (17 digits)**. Keep its own UUID meter-point ID, site facility fallback and all other scoped data/DTOs valid. Renderer prioritizes ediel_reference over other point/site IDs (`renderer:47–51`). This value is not a placeholder (`intent/noPlaceholderGuard.ts:42–50`); prerequisites and intent check presence, not length (`z01Prerequisites.ts:277–291`; `intentEngine.ts:277–290`). | Trace proves real customer export/source preparation and process resolver were reached, intent validated and renderer's actual strict `/^\d{18}$/` gate (`renderer:118–120`) threw “PRODAT Z01 kan inte byggas utan anläggnings-id/mätpunkt.” Gateway actual catch classifies render_failed with that cause and sets intent render failed (`gateway:150–173,453–464`). Zero finalized-message inserts, business-reference/message-event creation, outbox rows, message queue/status/send/provider effects. Preliminary outbound prepared/failed and request/intent diagnostics may exist. Do not change an ID to another valid 18-digit value and expect rejection. |
| Qualified-source rejection | Restore valid facility; change only native prepare DTO to `{status:'held',missing:['end_user_address']}` for the same exact RPC scope. All route/process/tenant sources remain valid. | Actual customerMasterdataSource line14 throws `customer_masterdata_source_held:end_user_address`; gateway reports blocked with exact cause (generic render_failed, not an invented national diagnostic). Same zero physical persistence/queue/business-effect ledger. This proves propagation from actual source decoder, not native source-authorizer correctness. |
| Wrong-role rejection | Restore success source; set only request_payload.actorRole='energy_service_company'. Real intent engine canonicalizes the payload role because routeProfile supplied by preparer has applicationReference only (`preparer:1071–1085`; `intentEngine.ts:113–129,216–237`). | Actual validation has prodat_actor_role_not_allowed; preparer blocks before actual customer render/finalization/queue (`preparer:1087–1147`). Intent/outbound/request diagnostic lifecycle is allowed; physical producer and forbidden business mutations absent. This establishes the reached TS role gate, not native tenant market-role authorization or every TEN-05 case. |

A missing-facility/manual-lookup row is optional, not needed to establish the late contrast above: real prerequisites may create a **preliminary** facility_lookup information request (`z01Prerequisites.ts:135–183,294–303`). If included later, enumerate that request service's exact IO separately. Do not assert “zero writes” for this branch or expand it into an additional implementation lane.

Use real tokenizer/composite access to inspect own segments and fields, including matching CCI qualifier to its following CAV and LI inside its own LIN group. Independent expected values come from frozen fields/configured source rows, not by comparing two outputs derived from the same mapper. Capture successful stored wire hash and exact message/intent/outbound/profile/operation IDs at the actual IO boundary. Keep legal FR/DO distinct from both transport parties to discriminate accidental fallback.

## Effect ledger and true blockers

Allowed preliminary effects on rejection: own route-decision diagnostics if a real routing IO implementation records them; own outbound prepared/failed status/event and response diagnostics; own request pending/failure annotations; actual blocked/failed intent validation/render lifecycle. On success additionally allow the own information-message/reference/event/outbox effects above. Native customer-source preparation may itself prepare a private source context, but its internal writes are not simulated as verified behavior.

For every row, deny/record any write outside the enumerated lifecycle tables/fields; specifically no mutation of customers, customer_sites current supplier/verified network data, metering_points or their annual values, customer_contracts/readiness, POA/auth sources, supplier_switch_requests confirmed/active state, customer_supply_periods, activation periods or metering/billing business projections; no Z03/Z04 production or activation dispatch. Include existing own business-row sentinels and compare before/after. A no-called activation spy without a complete IO mutation ledger is inadequate. These assertions cover the finite process boundary; they do not prove that native database triggers cannot cause effects.

Actionable preparation blockers, to retain with owners:

1. The declared `__tests__/fixtures/ediel-pinned-prodat-read-boundary.ts:11–16,47–55` accepts only Z13/Z09/Z04, ESCO test-run originals and certification witness state. It cannot be used unchanged as a Z01L supplier/native-issuer grant. A new suite may configure local **synthetic finite RPC data** for ordinary L, with real decoders; it must not edit that retained fixture or invent a native fixture/issuer workflow. `sourceOwnerFixtures.ts:8–22` similarly labels its activation rows synthetic and starts with Z04/L/inbound. Adapt only data local to the future new test, preserving production source checks. If owner-compatible finite response shape cannot satisfy actual kernel checks, report exact setup obstruction; do not mock canonical validation/finalization to force success.
2. Site-process context exposes authorizationReady/contractReady/blockers, but customer renderer `:96–105` checks supported process/variant and later reads requestedStartDate; it does not explicitly reject all readiness flags. Therefore a no-POA fixture does not justify expecting a renderer denial. Native source/current authorization gates remain owner proof, and any newly observed reachable obstruction must be handed off rather than changing source. Wrong-role TS row above is the genuinely reached role discriminator.
3. Preparation constructs outbound explicitly; arbitrary stored inbound direction is not a proven negative here. Real intent validation `:194–237` runs sender/direction checks inside its outbound branch. Do not fabricate a native-direction blocked receipt or claim the full wrong-direction prohibition from an unexecuted finite row.
4. Canonical profile/field checks stay actual, but selected complete positive fields and these narrow negatives cannot establish every P-01 R/D/parent/register condition. The full native insert/current-source/seal/outbox guards are not exercised by a table adapter.
5. Actual request/watch persistence after transmission, CONTRL and negative/positive APERAK consumption, time-driven SLA behavior, own customer/object/grid/LI/variant Z02 consumer and later independent Z03/Z04 readiness/activation remain outside the suite. Parsed expectedZ02Variant or ACK due fields are not those effects; no positive APERAK start barrier is inferred. This scope cannot promote the entire AT-Z01L or any native/transport readiness record to PASS.

Read-only discovery used targeted rg/rg --files, bounded source reads, complete L/rule JSON records and SHA256 of decisive inputs. All planned observations above are NOT_RUN. Root owns the final task plan, reservation/CI handoff and later review.

## Input SHA256 map

All relative inputs below are frozen worktree files, except the explicitly absolute scout. SHA256 is byte-based.

```json
{
  "AGENTS.md": "9f1b78b4b99a7b1dfad26649ced506fd72667d5f619b113cac354b8ccad0fa96",
  ".agents/skills/writing-plans/SKILL.md": "72190c88b2b5a67a96b91d66aa72b9161913e10e8769da3f28a226f4cc7b99d0",
  ".agents/skills/full-e2e-verification/SKILL.md": "e56d901a2760b281cf93213b446ef2968a1cf45ea9eaefc361a5b80e4d63d180",
  "docs/ediel/masterplan-v2/registers/acceptance_tests.json": "e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10",
  "docs/ediel/masterplan-v2/registers/rules.json": "48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8",
  "docs/ediel/masterplan-v2/registers/source_manifest.json": "ae5561799f6c81d78a139e4f5f82e74228bb765369fc6876668ae99ac338892d",
  "docs/ediel/masterplan-v2/registers/prodat_message_cases.json": "77c5023457d8e405d6a560b2d2515679c2d7b59bf968800f35c16070e5f8eeee",
  "docs/ediel/masterplan-v2/registers/prodat_fields.json": "e1248f8f4ec025aa5d71e3b3249ee70b6e9e0d8e0e48a4ec6f0db11e31178354",
  "docs/ediel/masterplan-v2/registers/prodat_conditional_cells.json": "55d44fcf337b5a7c9508c50bd25b9f204128ae2939ee36e49e74072b031a4b5d",
  "docs/ediel/masterplan-v2/registers/prodat_parent_groups.json": "89d3d00ae091f85a11b88aff5761f63328023e7f553e1d44b04ff74a736a95c7",
  "docs/ediel/masterplan-v2/annex/source_tables.json": "a23e928bdbe7e4bd514df99c789482023aea1d2f70f2a26f4a7ae5c05c973728",
  "lib/ediel/flows/prodatCustomerMasterdata.ts": "e55251ee640d25bc93995e54eabed92bf5df8579a43a2b181521a89f695f3f81",
  "lib/ediel/flows/shared.ts": "e555e45fee1762e2b19cba794354207ae170f62f7f49230f06ca31f815f74f49",
  "lib/ediel/flows/routeDecisionContext.ts": "cf2a1c5fc0d52ffb9af23d5bf9195b8fc8f1e1061e9257439ff05bfa7227b3cb",
  "lib/ediel/intent/intentEngine.ts": "b56e03cb0fc92835fbfd49812224015bdd7d27348b84a2bfa178965276c02829",
  "lib/ediel/intent/noPlaceholderGuard.ts": "33a5f8b0a4a040ca5911557659036939c64ce0d3649c4457a85de73fdcb0daab",
  "lib/ediel/intent/renderGateway.ts": "aaa06c9f2762eac28e4e7a53aba31dfeb93b8cbe549a2f2a675d728a84e1d59f",
  "lib/ediel/intent/renderers/customerMasterdataZ01.ts": "63a4dadcc251153a15fd29cf52ae65694776ad5295899d4e2c45baf35e712cb6",
  "lib/customer-operations/z01Prerequisites.ts": "0a63b2b582b9a62fb88367157451bc2c2e88cd18359ed918b8367edafe3bbd59",
  "lib/customer-operations/customerSiteProcessContext.ts": "db2b4fc94e452a221a3857240708c1891d3008fc85ec9a7e78da04309859a281",
  "lib/cis/db-shared.ts": "289de6560100e5d6b2b8db620dfc093228fa62c5460b9e71b64fe5cc5bc351c2",
  "lib/cis/db-data.ts": "5299216751a3f5e644b0917197fd5ed493c8c69ece86426cf9979d9856e22464",
  "lib/cis/db-outbound.ts": "f061ca0f0c005861cd9c3a56f13ef6e59daf6264cce96607c4970c824865b05a",
  "lib/tenant/governance.ts": "3473e7f4dd497b377af05d1bb07c9c88f14b04a6a994b220eafbf938becd0ebe",
  "lib/ediel/services/authorization.ts": "d172c213c5713e613b02760538136ebf3de373cfd56b39bb08d851f273bf38ba",
  "lib/actor-registry/registryMarketSource.ts": "67e1f758203b88161989286e24e20b552b77c08ae2cbcdd161d8a13ce712c4a6",
  "lib/ediel/production/customerMasterdataSource.ts": "ff6a2521f1ac31661ca47d87144f8f9c683638a417990321c79ca3d7c69f7e8b",
  "lib/ediel/production/customerLifeEventExport.ts": "b59d16d7a36b59d10e29f523798fe6ac86ca0fa0d706a27f54855c89698836a4",
  "lib/ediel/prodat/z01LegalParties.ts": "c3282798a5402948736452a81363a869b1ad75eb59dace27025f040745c01362",
  "lib/ediel/prodat/customerIdentity.ts": "37fbcf7e62de8d10f82f8c8d78c8b9390f4a9d7341131e87442c801a487b3c23",
  "lib/ediel/prodat/customerMasterdataAuthority.ts": "2ca8db38937fbf890d307f4ad5e3b86396b68153dddcbd39600ebe9171d4156c",
  "lib/ediel/prodat/customerMasterdataDraft.ts": "630ac102a90d3b79161dfe933838f8eaef07bc7552f3488d9d281635a4992534",
  "lib/ediel/prodat/z01WireReferences.ts": "9725507394ab36a27a5152977e61f05ea90decf268b43401b432ab7f5dbab2f6",
  "lib/ediel/prodat/z01OriginalReplay.ts": "7e881114e224ada6f69e8c05534f8d5fe6ad205cc3e032a2af89a0612158c78c",
  "lib/ediel/prodat/engine.ts": "eddc1e0d6a72d0aa0affd62192c471b795e7faf153509e0d517ccc5d36646514",
  "lib/ediel/prodat/builders/profileRenderer.ts": "7d5eff3c51ecb817a1378d55e5821dc437017e41849bb256671d15db16471c95",
  "lib/ediel/prodat/builders/z01.ts": "05e3393a562c7f224082551d35ee974f8fb6bba624c0659989e30ef16a5c34d1",
  "lib/ediel/prodat/prodat26AFieldMatrix.ts": "a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382",
  "lib/ediel/prodat/prodatDateFields.ts": "5dcc9d8aff057bef42fa974f9cb3cc71da3f1b2f9e04edba3a238738420705cb",
  "lib/ediel/prodat/render/dateSegments.ts": "d89e340f6638a8633f405af3a1fc14ccb260363900caac6fe0d10f1d7e802bd8",
  "lib/ediel/prodat/render/dates.ts": "25b2cd8c56b4cb7c824c6ed6c6ecc8783b8843212387f4cb08223fc157b40505",
  "lib/ediel/messages.ts": "1bcfe177db9e7fad4a25342ce82a7c9b1cc5904428df26e2cf84ab9a9d02faa1",
  "lib/ediel/core/edifactEnvelopeCodec.ts": "92834d6d359a15b85e8244683de7a4c9df3075403918a7cc088930ef495095ed",
  "lib/ediel/core/edifactTokenizer.ts": "11b8b0546e794a2fe60c9aeaf6c3d811e9e6ca0e5a777171b4064a6679ced93f",
  "lib/ediel/core/messageBuilder/payloadPreflight.ts": "f6c620626a859ea40f14990b5c2c778d175c26121965d1907d8398936b0a6668",
  "lib/ediel/core/versionRegistry.ts": "ec62231af36ecde38a8377662ca6586e8846170b617e3e51e1eded27c915aa68",
  "lib/ediel/core/ackPolicy.ts": "daf2d4ad8b31b67263217f51590baae7f0039a629c24fcff42d13f7c7d40282f",
  "lib/ediel/core/kernel.ts": "e375037eccec1bd140faeee524b86cc5ff9eec8b165e63c0cc9e8f4dcd5cc7b1",
  "lib/ediel/core/kernelLegacy.ts": "b6680e10b8b743678b895804661a6e497740893bf778b274b871bfa34c3bab21",
  "lib/ediel/core/routeRegistry.ts": "e9e36c9c2b99b2cb8086523b9ad0787830ce7777e5773c5c3de8d00d9f75441a",
  "lib/ediel/core/outboundOwnerWitness.ts": "a26cdec3e3c861aeffb3de18ef5e3d8d3fbd311d17106b3c3171c3d43657f0f6",
  "lib/ediel/rulebook/validator.ts": "ac9806db14070125224d0d6e78293374e17b3a3bd1714cc4675d897401a62ec1",
  "lib/ediel/rulebook/canonicalRulePackRegistry.ts": "5b1d47c9379aa22ba8bc0df60de6fb158ef3f54c882951a9107bf7c618009976",
  "lib/ediel/rulebook/canonicalPolicyFieldValidator.ts": "ac76e0e39f49e4b3ec0eed8dad1cc83214c9828b472d54b6a98eb0b3cd4fe3c3",
  "lib/ediel/db.ts": "45a44daa8eec2beca4e0fe70f40f4d0a9a09165df29f8025246704519e1cd1f0",
  "lib/ediel/outbox/createOutboxItem.ts": "412d05c89423ca9bee10fc7f18941b5c1e463b892ea796ca170f8909fd5b304a",
  "__tests__/fixtures/ediel-pinned-prodat-read-boundary.ts": "312e22f112119e9dde93471920bb1edf3c265fbf7a0b76156c22012468606aee",
  "__tests__/helpers/sourceOwnerFixtures.ts": "bbe5f5f5b60976aa8eefedf0196557f6d5a13cdc58e49e859e7d7a6c763f8620",
  "/tmp/gridex-next-profile-ownership-scout.md": "bf1aebd3d59b59242fdcd7ead1d841eb256248660a8711cc1d8aa3f463d8d38c"
}
```
