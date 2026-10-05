# AT-Z03L-SUPPLIER ordinary producer finite boundary

Read-only per-ID preparation, 2026-10-05. No reservation or next-lane claim is made. Root's owner/PR scout is separate. This blueprint proposes one new ordinary L producer coupling, without editing source, native SQL, renderer, retained tests, CI or dependencies. No test or harness was executed. The only authorized output is `/tmp/gridex-z03l-finite-boundary.md`.

Authentic source pin: **main `fff486f822001d35970f163507b10e17c3692f58`**. Read worktree: `/workspace/gridex-ediel-at-z01l-z01lk-supplier-20261005`; observed HEAD `0674fc210fc0ee616759b79b053ef6e36d674a63`. The full Git diff has only 14 new L/LK test/docs/memory/audit paths, no pre-existing product/spec/native/coverage changes. Every hashed input below was independently read from the authentic main Git blob and compared byte-for-byte with the worktree input. Do not present 0674's new nine-case suite as runtime-validated or as Z03 evidence. Root must refresh source/ownership pins before assigning a writer.

Skill routing: writing-plans supplies the bounded task blueprint; full-e2e-verification supplies outcome/boundary limits. Source/refutation discipline from spec-to-code-compliance and fp-check is retained without asserting a confirmed defect or running their broader audit/delegation workflow. The explicit read-only scope overrides ordinary plan execution, memory writes, commits and subagent instructions. Browser, security scans, performance, implementation, native execution and external operations are outside this preparation.

Paths/line anchors below are relative to the exact absolute worktree above. The requested producer name `prepareProdatSwitchFromSwitchRequest` was not found by repository rg. The actual ordinary production entry is **`prepareAndQueueProdatSwitch`** (`lib/ediel/flows/prodatSwitch.ts:111`), called by `prepareAndQueueEdielZ03` (`:342–344`). Use these actual functions, not a reconstructed alias.

## Full original contract and applicable cards

Authentic `acceptance_tests.json:2776–2791`, CASE at `prodat_message_cases.json:39–54`, and the three full rule cards (`rules.json:183,483,543`) are preserved verbatim below. Their execution/evidence fields are frozen specification metadata, not a result from this preparation.

```json
{
  "acceptance": {
    "id": "AT-Z03L-SUPPLIER",
    "name": "Meddelandefall Z03L",
    "given": "SUPPLIER; Startfönster L D-14 dagar; LK senast inflyttningsdagen; max14 kalendermånader före.",
    "when": "Nytt giltigt leveransavtal; L=leverantörsbyte, LK=kund- och leverantörsbyte/flytt.",
    "expected": "23-DDQ-PRODAT; BGM=Z03; fält223=Z22; CONTRL, APERAK, rätt Z04L/LK; dessa är olika förväntningar.; Skapa bytes-/flyttärende och tillåtna timers, inte aktiv leverans.",
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
  "case": {
    "id": "CASE-Z03L-SUPPLIER",
    "family": "PRODAT",
    "code": "Z03",
    "subtype": "L",
    "wire_reason": "Z22",
    "operating_role": "SUPPLIER",
    "direction": "outbound",
    "application_reference": "23-DDQ-PRODAT",
    "trigger": "Nytt giltigt leveransavtal; L=leverantörsbyte, LK=kund- och leverantörsbyte/flytt.",
    "expected": "CONTRL, APERAK, rätt Z04L/LK; dessa är olika förväntningar.",
    "permitted_effect": "Skapa bytes-/flyttärende och tillåtna timers, inte aktiv leverans.",
    "additional_guard": "Startfönster L D-14 dagar; LK senast inflyttningsdagen; max14 kalendermånader före.",
    "capability_status": "Tillämplig",
    "field_profile": "prodat_fields + prodat_conditional_cells + parent_group + register_overlay",
    "source": "P §2.1–2.2,2.6; HB kap.4,10,11",
    "test_id": "AT-Z03L-SUPPLIER"
  },
  "applicable_rule_cards": [
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
}
```

The source hierarchy remains frozen original masterplan text/registers → actual code/schema → fresh execution receipts → memory. Original P26.A rev3 electricity custody is the retained manifest original SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`; this is not a fresh original-PDF review or transferable gas/bilateral/certification authority.

Full Z03 field projection read from frozen `prodat_fields.json`: R=311,312,202,203,313,205,206,207,208,314,209,210,217,223,260,261,226,227,228,231,232,316,262; D=229,233,234,250,251,252,253,317,318. UD is R, IT O, IV D. PC-229-Z03 uses active UD/available own address; PC-233/234-Z03 uses selected IT; IV children apply only when IV is active, with field252 also conditioned on applicable address. All unknown own-send facts fail closed. The new suite should supply full UD and IT, with a real explicit inapplicable IV selection/evidence rather than omit IV on an invented assumption. Full invoicee/74-field/110-D/register permutations remain with retained field owners.

Important distinct L wire fields: BGM202=Z03 (no suffix); BGM313 acknowledgement-request field is required for Z03 (`prodat_fields.json:234`); reason223=Z22; measure method217 from the signed requested-method declaration (`:1440`); grid260 **RFF+Z05**; POA261 RFF+ANJ; LI226 RFF+LI; BRP262 NAD+Z02 with 160/SVK (`:3675`). Annual213 is optional for Z03, unlike Z01. Do not import the Z01 “no QTY31 under every circumstance” rule here: baseline may deliberately omit annual volume and assert unrelated stale annual values are not borrowed, but an own legitimately selected optional field213 is a separate field-owner condition.

## Actual ordinary producer and where coupling is missing

`prodatSwitch.ts:111–153` rejects non-Z03 production, loads switch/site/point/grid owner by actual IDs, selects L/LK/C/H, requires exact contract and calls `gridex_assert_supplier_switch_ready`. Ordinary L must avoid cancellation_requested/C and H/Z25; no bilateral owner source is granted to L. `:145–181` resolves actual canonical rule-pack and route. `:189–224` creates/reuses the own preliminary outbound and maps authorization. `:226–279` allocates four actual wire namespaces and creates the actual persisted supplier-switch intent. The producer hardcodes actorRole supplier and direction outbound; it does not prove every native wrong-role/direction authorization case by itself.

`intent/switchRenderGateway.ts:10–22` re-reads/revalidates the stored intent and compares exact company/customer/site/switch-operation/route/profile/environment/transport parties/subaddresses. `:24–39` calls the actual switch renderer with **persisted** UNB/UNH/BGM/LI, attaches actual intent/outbound/sourceOperationId, finalizes and records rendered lifecycle. `:40–42` then calls `ediel_bind_switch_original_v1`, propagates native errors, and requires bound receipt matching the actual message ID. **Queue is line43, after original binding**; outbox lifecycle advances only at line44.

Actual renderer is `prodat/compatAdapter.ts:579–823`, reached through `buildProdatZ03FromSwitch:918–922`, facade `lib/ediel/prodat.ts` → `prodat/z03.ts`. It:

- performs actual initial context/POA presence checks and actual tenant actor authorization (`:590–615`);
- computes a fixed-P-profile source-evaluation instant from the requested calendar day (`:610`), reads actual source export with `requireCustomerMasterdata:true` and asOf (`:615`), and checks exact selected customer/site/point (`:617–619`);
- consumes real `readContractRequestedMethodSource` and selection checks (`:627–630`), then real `prepareQualifiedBrpSource` with **supplyPeriodId:null**, own contract/scope/start instant (`:634–636`);
- projects protected customer identity/name/address, source point, source requested method/BRP/day into rendering, overriding corresponding stale portal/testCaseOverrides values (`:482–508`), while ordinary reason is still selected from saved portal data (`:541`);
- uses real canonical version, renderProdat in production mode, field/date/profile checks, envelope/tokenizer/preflight and actual ACK defaults (`:659–720`);
- returns the exact draft through `rememberCustomerMasterdataDraft` (`:754–823`), so real shared finalization consumes the customer projection's real WeakMap binding.

Keep `flows/shared.finalizeOutboundDraft:226–266`, real kernel canonical validation/registry/ordinary owner-witness/persistence, real DB linking/status/events and `queuePreparedEdielMessage:269–319` actual. Native source DTO replies are finite IO, never functions mocked to return pre-branded source authority or rendered/canonical success.

After gateway returns, producer `:307–336` links the original and emits actual `ediel_prepared` supplier-switch event when its returned message object is draft. Real queue updates persistence but returns the original message object; finite adapters must return **copies**, not mutate already-returned rows in-place and accidentally skip these real producer effects. `operations/db.part-2.ts:673–703` obtains actual actor through auth.getUser and inserts the event. Its company_id input may be null because source scope is derived by `gridex_correction_process.bind_switch_event_owner_v1` (`schema.sql:7081–7098`, trigger `:143026`). This existing owner trigger refutes a tenant-defect assertion based only on that null scalar. A finite test records the actual insert plus its exact own switch ID; a simulated trigger output is not native trigger execution.

Current narrow evidence gap is concrete coupling, not absent behavior: `__tests__/ediel-normal-switch-intent-gateway.test.ts:9–16,29–54` replaces intent validation, renderer, finalizer/queue and native RPC with mechanical projections. `ediel-prodat-register-compat-outbound.test.ts:11–16,29–51` runs actual rendering/envelope but replaces export/authorization/method/BRP source functions and never calls the complete producer/gateway/binding/queue. `ediel-contract-requested-method-source.test.ts` and `ediel-brp-field-source.test.ts` separately check DTO consumers. `ediel-canonical-deadline-policy.test.ts:53–61` checks pure timing. Existing outbound-reuse, cancellation, original replay, bilateral H and Z04 commit tests are different paths and should not be copied into this new ordinary-L proof.

## Latest native binding underlay: preserve it, do not bypass it

The current schema and all replacements were searched. Ordinary L uses:

`public.ediel_bind_switch_original_v1` (`supabase/schema.sql:41784–41806`) → non-bilateral branch `gridex_bilateral_prodat.bind_switch_before_bilateral_v1` (`:3405–3411`) → `public.ediel_bind_switch_original_before_brp_source_v1` (`:41721–41730`) → base `public.ediel_bind_switch_original_before_method_v1` (`:41736–41779`), then signed-method binding and BRP binding.

The composition was restored by `20261001142640...:21–42`; later `20261002233700...:41–64` changes H only. Do not incorrectly report the old dropped-wrapper bug as current. Ordinary L is not a bilateral H original; no H fixture/workflow is introduced.

Actual base requires actor membership/permission, exact stored intent/operation/switch/customer/site/point/contract/outbound, lifecycle_blocked=false and allowed preliminary switch status, no existing outbound-Z03/inbound-Z04, draft sealed immutable bytes/hash, outbound payload environment, signed/versioned own contract, and actual physical source tuple. The tuple includes installationPoint equal to **mp.ediel_metering_point_id or meter_point_id**, identity agency9, own customers org/personal identity qualifierSE1/SE2 and agency260, expected reason derived from **scoped switch** (`:41761`), own nonempty LI, and requested calendar start day (`:41762–41771`). Only after all those checks does native source update own switch outbound_z03/rff_li/status prepared (`:41774`) and insert the private original (`:41775–41776`). This is permitted preliminary source binding, not supply activation.

Physical underlay `supply_wire_v1` (`schema.sql:27611–27647`), `normal_switch_wire_v1` (`:24641`), `switch_origin_wire_v1` (`:27702–27722`) reads real release/UNA-decoded legal NAD FR/DO with 160/SVK, one own LIN, reason, LI, grid and start DTM92/203; UD/optional IT must match the own object. Signed-method binding requires physical CCI Z04/CAV method, contract source identity/hash and legal/grid/point tuple (`20260930234708...:34–59`). BRP binding requires actual NAD+Z02+id:160:SVK and same signed source at the fixed-P start instant (`20261001011248...:27–49`). Preserve these dependencies in the finite inputs and handoff any incompatible generated wire; never return unconditional bound to evade them.

A permitted finite original-bind reply tests **gateway consumption only**. Its handler must be restricted to the enumerated own company/switch/message/actor tuple, look up the exact actually persisted original and intent/outbound IDs, assert independent expected physical/source values and ordering, and return the one configured synthetic bound receipt only for that positive row. It must not learn the first caller's bytes as authority, reuse an unrelated original, manufacture private issuer/currentness state, or reimplement the complete native SQL owner in TypeScript. A negative row can explicitly return a configured error/held receipt for the same exact tuple and prove error propagation. Such a response is not execution of the native owner. If independent positive compatibility assertions fail, preserve the first reached obstruction and stop the positive claim.

## Finite IO ports below actual consumers

Use strict finite table/RPC dispatch with exact predicates/order/limits, cloned responses and a full mutation ledger. Reject every unexpected RPC/write. Prefer an existing own preliminary outbound with no original/intent message to avoid unrelated create/cancel/TGT regeneration routes. Use explicit test environment and ordinary nonportal route. Routing/current canonical context can be declared finite below the real routeDecisionContext/appref/version wrapper; this cannot prove real native route or legal issuer authorization.

| Port | Required exact data/reply and actual consumer |
| --- | --- |
| Supabase service/server base + auth | Real table consumers use one finite adapter; auth.getUser returns exact actor for actual supplier event; makeServerClient is external client creation only. Keep actual shared preparer/gateway/finalizer functions. |
| Selected rows | `supplier_switch_requests` by own ID; `customer_sites`, `metering_points`, `grid_owners` by exact selected IDs (`operations/db.part-1.ts:1060–1074`; `masterdata/db.ts:242,518,621`). Scope consistency remains actual in compatAdapter617–619. Provide own customer/contacts/site/point/contract rows for real cis export and an unrelated company/site/switch/point with different physical/LI/day values that must remain untouched. |
| Preliminary outbound/history | Real `findOrCreateSwitchOutbound` (`shared:104–156`) checks payload.environment and own operation/customer/site/point. Existing own row has source_type supplier_switch_request/source_id own switch/request_type supplier_switch, operation_id equal own switch ID and own route. `ediel_message_intents` existing-idempotency query empty; original/dedupe `ediel_messages` queries empty. Do not copy original replay tests. |
| Tenant/company read IO | Exact active/accepted `company_memberships`, own active `user_profiles`, own operational `companies`; permission RPC `gridex_actor_has_company_permission` only exact actor/company/reached read/write/testing permissions. Actual tenant authorization and operational checks stay real. Boolean IO true is not native RBAC proof. |
| Native readiness RPC | `gridex_assert_supplier_switch_ready(p_company_id,p_contract_id)` for selected own signed contract; configured ready response, or one configured same-scope source denial. Actual source/schema function (`schema.sql:50525–50547`) checks lifecycle view; do not encode every deadline failure as a synthetic readiness error and call that deadline enforcement. |
| Canonical activation RPC | Real `resolve_canonical_ediel_rule_pack_with_witness_v1` decoder/source comparison for electricity/PRODAT/Z03/L/outbound/date, E2SE6A, guide26.A/r3, selected pack/profile/version/source hash and internally consistent original snapshot/ready flags. Return configured **synthetic IO evidence** for this exact profile/date; no arbitrary activation rewrite or copied Z04/L/inbound row. |
| Customer life event/source RPCs | Real cis export calls dated `ediel_customer_life_event_export_at_v1` because Z03 supplies asOf (`customerLifeEventExport.ts:33–56`), normally explicit not_applicable; real `ediel_prepare_customer_masterdata_v1` validates exact company/customer/actor/environment/asOf and source identity/hash/context/name/address. Use protected **identity equal to the own customers identity** to satisfy the native base, while protected name/address differ from stale preview to show actual source consumption. Preserve real WeakSet/WeakMap binders. |
| Signed requested method RPC | Real `readContractRequestedMethodSource` consumes `ediel_contract_metering_request_source_v1` for exact company/contract/actor/test. Authorized DTO has own declaration/contract/customer/site/point/legal-actor UUIDs, environment, requestedMethod Z03 or Z04 (canonical F/G method tuple), pointId18digits/agency9, legalSenderId/legalReceiverId/gridArea and version/hash/source facts; actual selection checker compares own customer/site/point (`contractRequestedMethodSource.ts:4–20`). Preserve same point as native meter physical selector. A held missing authentic declaration remains held. |
| Signed BRP RPC | Real `prepareQualifiedBrpSource` calls `ediel_brp_field_source_v1` with own company/contract/actor/environment/customer/site/point, fixed-P `at` and periodId null. Authorized DTO must be **signed_contract_brp_declaration**, own contract/declarationUUIDs, same physical/legal/grid tuple and exact same instant; brpEdielId≤35 without control chars. Actual `checked` and cross-source compare remain real (`brpFieldSource.ts:5–30`; compatAdapter634–636). With periodId null it cannot use accepted prior supply or qualify a structural candidate. |
| Immutable registry dispatch RPCs | Real kernel fresh-source readers need both `ediel_registry_dispatch_source_v1` and nested `ediel_registry_route_source_v1`; exact company/communication route/profile/test/PRODAT/DDQ, EL actor/hashes/legal/wire match configured current context. Keep decoders. No native current identity/source authority follows from those supplied DTOs. |
| Ordinary owner-witness RPC | `ediel_prepare_outbound_owner_witness_v1` exact actor/company/test/actual raw/original canonical evidence, with configured UUID witness/evidence/snapshot identity checked by real decoder (`core/outboundOwnerWitness.ts:6–26`; kernel719–743). No H, ACK, recovery or positive/negative-certification fixture IDs. Synthetic reply proves original evidence consumption, not native seal/issuer readiness. |
| Original bind RPC | Restricted `ediel_bind_switch_original_v1` handler as defined above; success only after actual message insert + rendered intent, exact persisted original hash/IDs and independently asserted compatible own wire/source. Configured same-tuple denial must leave no queue. No always-bound grant or native SQL replica. |
| Actual writes | Keep real intent upsert/lifecycle, actual message insert/link/status, business references/message events, real outbox upsert, outbound updates/dispatch events and real supplier_switch_events. Synthetic returned row may contain configured ordinary sealed attributes needed for boundary assertions but is not an executed native immutable trigger. Native source-owner binding's own prepared switch/private receipt is declared IO outcome; do not mutate customer/supply to imitate activation. |

Do not mock `getCustomerExportContext`, method/BRP adapter functions, source/draft brands, buildProdatZ03FromSwitch, renderProdat, field/date/version policy, tokenizer/envelope/preflight, intent validation/gateway, real shared finalizer/kernel, DB writer/event or queue adapters. Finite IO sits underneath them. A copied draft loses the source brand; the real gateway adds intent/outbound/sourceOperationId to the exact producer object before actual finalization.

## One unique ordinary-L coupled oracle and narrow contrasts

Configure distinct valid UUIDs for company, actor, customer, site, meter row, grid owner, contract, POA/auth document, own switch, unrelated switch, outbound, intent, rule-pack/profile, source declaration and generated message. **operation_id must equal the own switch UUID** because that is the ordinary native source operation, not a separate fabricated event UUID; it remains distinct from all unrelated IDs. LI/BGM/UNB/UNH namespaces stay actual allocator output; compare each persisted intent namespace against actual tokenized wire without assuming UNH messageReference differs numerically from every other message.

Proposed fixed external clock for the future suite: 2026-10-05T10:00:00Z. Keep date logic real. Own intended start calendar day=2027-06-15, unrelated/site/preview day=2027-07-03. This is within L's 14-calendar-month and D−14 window. Actual P wire must be DTM+92:202706150000:203 and DTM+ZZZ:1:805. The source read instant is 2027-06-14T23:00:00Z (fixed UTC+1), **not a real activated supply timestamp or Stockholm DST authorization**. No test executes time-driven activation or treats queue time as start time. Date-window boundaries are a retained whole gap unless an actual reached gate is exercised; pure deadline success alone cannot qualify this producer.

| Planned row | Coupled observation and rejection effect |
| --- | --- |
| Ordinary L with stale preview | Own switch request_type switch, prodat_variant L/prodat_reason Z22, no originals, own signed contract and current compatible DTOs. Stale preview has other customer/facility/name/address/day/method/BRP values and testCaseOverrides for method/BRP/day; keep reasonZ22, own grid and own POA reference compatible. Actual protected source projection overrides stale customer/object/address; method/BRP/day source overrides preview. Assert real stored intent→physical BGMZ03 + CCI Z13/CAVZ22, CCI Z04/CAV declared requested method, own NAD Z02 BRP, own physical point/agency9, legal FR/DO separate from UNB transports, RFF+Z05/ANJ/LI, full UD + applicable IT/IV checks, exact day and ACK requirements. Assert actual message is persisted before bind, bind consumes its exact ID/intent/switch/outbound/operation/wire, then same ID reaches real outbox and real own ediel_prepared event. Source/preview/unrelated business rows stay unchanged except explicitly permitted preliminary source bind/lifecycle. |
| Same protected method source becomes held | Keep all other own rows/route/readiness/source valid; RPC returns status held/missing unique_authentic_new_agreement_requested_method_declaration. Real decoder and compatAdapter628 throw prodat_new_agreement_requested_method_held with that cause. Preliminary outbound/intent may exist; no message insert, bind, outbox, supplier prepared event, activation/business-state mutation. This is actual source-error propagation, not native issuer validation. |
| Selected source scope mismatch | Keep baseline; requested-method authorized DTO carries only another valid site UUID. Decoder accepts its allowed shape, real assertContractRequestedMethodSelection rejects contract_requested_method_selected_scope_mismatch before rendering. Same no physical original/bind/queue oracle; proves real selected-scope consumer, not a canned held response. |
| BRP and requested-method disagree | Keep own valid scope/instant/BRP declaration; change only BRP legalReceiverId to another nonempty legal party. Real BRP DTO shape passes, compatAdapter636 rejects prodat_new_agreement_brp_source_scope_mismatch. No physical original/bind/outbox/event/activation. Useful cross-source real consumer contrast beyond separate adapters. |
| Native bind denies the generated own original | Produce the same actual compatible L raw, real finalize/persistence and rendered intent. The restricted exact-tuple bind IO returns one configured source-change error (or bound receipt with another message ID for response-identity rejection). Real gateway propagates error/throws switch_original_native_binding_required and never calls queue/upserts outbox/advances queued lifecycle/emits producer prepared event. **One persisted rendered draft and its creation/reference/event artifacts are permitted here**; do not demand zero message writes after this late gate. This row demonstrates consumer ordering/error behavior only, not native execution. |

The new subject is the complete real ordinary producer, not existing gateway's mechanical references/replay/cancellation matrix. Source held/scope/BRP negatives must establish the first actual reached gate rather than assert a later arbitrary message string. If an earlier national field/IV/policy/owner seal constraint blocks the positive fixture, record it as setup/source obstruction and retain the real gate. Do not stub that gate to rescue the proposed positive row.

## Source obstruction handoff and bounded conclusions

1. **Stale reason is a draft/setup candidate, not queued native evidence.** Preparer normalizes L/reasonZ22 (`prodatSwitch.ts:48–66,140`) and stores that on its intent (`:263–272`); renderer ordinary reason still comes from validation_snapshot.portalData (`compatAdapter.ts:210–224,541`). A saved reasonZ23 on an otherwise L switch can make physical profile/subtype selection disagree with intent metadata, but actual finalization may stop earlier, and native base derives expected reason from own switch and rejects wrong physical reason at schema41770 before prepared switch/original writes41774–41776. Gateway binding is before queue. Do not claim queued wrong-L output or request a production fix without a concrete actual execution path. If encountered, hand off exact input row, actual raw/profile/reason, first reached rejection, source/contract/hash/operation tuple and the no-queue ledger; source/native owners decide remedy.
2. **Physical aliases and UD identity cannot be invented.** Native original accepts mp.ediel_metering_point_id/meter_point_id and own customers identity. A positive DTO carrying only a different valid ediel_reference or a protected identity unrelated to own customer cannot be turned into a native compatible success with a bound mock. Reconcile finite rows to actual own source or report the real obstruction; no issuer/source mutation authorized.
3. **Early malformed/missing source and late native rejection have different permitted writes.** Before render, no message/outbox; after finalization but before native bind, sealed draft/intent/reference/created events may exist. Bound original updates own switch to prepared and records private original, which are permitted preliminary lifecycle effects. None authorizes confirmed/active switch, live supply period, customer current supplier, annual-volume mutation, real market activation, Z04 interpretation or a transport send.
4. **Native method/BRP wrappers are current and required.** Latest ordinary chain retains both; an always-bound reply that ignores them creates a fixture success without source compatibility. No new native registration/fixture authorizer/profile/SQL execution workflow or duplicated private engine is in this plan.
5. **Full AT outcome is larger.** Real window enforcement at the applicable action/send boundary, authentic signed declaration/BRP/customer/registry source and current actor/direction authority, full R/D/register facets, real customer request/switch/watch persistence, independent CONTRL/APERAK/Z04L expectations and their consumers/timers, own correlation/mutation gates and later customer activation remain with retained owners. ACK flags/due fields/outbox IDs do not prove consumed ACKs, delivery, timer firing or activation. No whole-ID PASSED/VERIFIED, runtime-native or market-ready claim follows from this blueprint or future synthetic port success.

Record all table mutations/RPCs in order. Permit only enumerated own preliminary lifecycle/original/message/reference/event/outbox effects; reject any customer/site/meter/contract/authorization/BRP-source mutation, confirmed/active supplier state, customer_supply_periods or activation-period insert/update, unrelated switch/LI/day/grid borrowing or provider call. Preserve unrelated rows/bytes/annual values. Source-read RPC internals and native triggers are not verified by a finite adapter, so an absence-of-business-write assertion applies to this observed finite consumer boundary only.

Root retains the final task plan/ownership/dispatch decision. No production fix is requested: all proposed rows are NOT_RUN, and static underlay explicitly refutes promotion of the stale-reason candidate to a queued native defect.

## Authentic input byte hashes

Each SHA256 below is of the authentic main Git blob at fff486f822001d35970f163507b10e17c3692f58 and was checked identical to the worktree path at preparation. No passing receipt is inferred from byte identity.

```json
{
  "AGENTS.md": "9f1b78b4b99a7b1dfad26649ced506fd72667d5f619b113cac354b8ccad0fa96",
  ".agents/skills/writing-plans/SKILL.md": "72190c88b2b5a67a96b91d66aa72b9161913e10e8769da3f28a226f4cc7b99d0",
  ".agents/skills/full-e2e-verification/SKILL.md": "e56d901a2760b281cf93213b446ef2968a1cf45ea9eaefc361a5b80e4d63d180",
  ".agents/skills/spec-to-code-compliance/SKILL.md": "eb0d91b50a9c06f50baf8763d1e23566897b9fa3e7ffcf13134eee4e1ccaefe5",
  ".agents/skills/fp-check/SKILL.md": "129223b79b8cb1e7c289c90cbe4ba288d9b210e318a0d1464f319e30329481b3",
  "docs/ediel/masterplan-v2/registers/acceptance_tests.json": "e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10",
  "docs/ediel/masterplan-v2/registers/rules.json": "48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8",
  "docs/ediel/masterplan-v2/registers/prodat_message_cases.json": "77c5023457d8e405d6a560b2d2515679c2d7b59bf968800f35c16070e5f8eeee",
  "docs/ediel/masterplan-v2/registers/prodat_fields.json": "e1248f8f4ec025aa5d71e3b3249ee70b6e9e0d8e0e48a4ec6f0db11e31178354",
  "docs/ediel/masterplan-v2/registers/prodat_conditional_cells.json": "55d44fcf337b5a7c9508c50bd25b9f204128ae2939ee36e49e74072b031a4b5d",
  "docs/ediel/masterplan-v2/registers/prodat_parent_groups.json": "89d3d00ae091f85a11b88aff5761f63328023e7f553e1d44b04ff74a736a95c7",
  "docs/ediel/masterplan-v2/registers/source_manifest.json": "ae5561799f6c81d78a139e4f5f82e74228bb765369fc6876668ae99ac338892d",
  "docs/ediel/masterplan-v2/annex/source_tables.json": "a23e928bdbe7e4bd514df99c789482023aea1d2f70f2a26f4a7ae5c05c973728",
  "lib/ediel/flows/prodatSwitch.ts": "9ae579c5acd42927894479d0a833c1560cda190ab72f37eaf69a4559f27cb3eb",
  "lib/ediel/flows/shared.ts": "e555e45fee1762e2b19cba794354207ae170f62f7f49230f06ca31f815f74f49",
  "lib/ediel/flows/routeDecisionContext.ts": "cf2a1c5fc0d52ffb9af23d5bf9195b8fc8f1e1061e9257439ff05bfa7227b3cb",
  "lib/ediel/intent/switchRenderGateway.ts": "a1de335c98cf210b24e3a1c3f5fed89c9844a5d42a5df5a4e2f4335330a13b13",
  "lib/ediel/intent/intentEngine.ts": "b56e03cb0fc92835fbfd49812224015bdd7d27348b84a2bfa178965276c02829",
  "lib/ediel/prodat/compatAdapter.ts": "731278945699538b10ea70f49426fe20f6c034efdd3cb47c3fbb0bf84d1b8537",
  "lib/ediel/prodat.ts": "a8278f7ccbe759608fa8ea33fc1951ce62b3e916adab9b1e4f7ba9c88bafcfd1",
  "lib/ediel/prodat/z03.ts": "a5e2a39c7240e8c934fd9f96127387f471e8ee4c8439f365eaa482b35b7cb543",
  "lib/ediel/prodat/engine.ts": "eddc1e0d6a72d0aa0affd62192c471b795e7faf153509e0d517ccc5d36646514",
  "lib/ediel/prodat/builders/z03.ts": "569a957252e319b79d9f2d356910202cf6734a7ed3b1a681f4cd39f2e2b6c535",
  "lib/ediel/prodat/builders/profileRenderer.ts": "7d5eff3c51ecb817a1378d55e5821dc437017e41849bb256671d15db16471c95",
  "lib/ediel/prodat/customerMasterdataDraft.ts": "630ac102a90d3b79161dfe933838f8eaef07bc7552f3488d9d281635a4992534",
  "lib/ediel/prodat/customerMasterdataAuthority.ts": "2ca8db38937fbf890d307f4ad5e3b86396b68153dddcbd39600ebe9171d4156c",
  "lib/ediel/production/customerMasterdataSource.ts": "ff6a2521f1ac31661ca47d87144f8f9c683638a417990321c79ca3d7c69f7e8b",
  "lib/ediel/production/customerLifeEventExport.ts": "b59d16d7a36b59d10e29f523798fe6ac86ca0fa0d706a27f54855c89698836a4",
  "lib/ediel/production/contractRequestedMethodSource.ts": "85a19426acaf93800c20330514ee8a3a798196990ebc3158c4b7dc0367a82f31",
  "lib/ediel/production/brpFieldSource.ts": "169cf824ceac83e190478806bccf3406fab3b033021d417f4a4336bf934b8f62",
  "lib/ediel/prodat/render/dates.ts": "25b2cd8c56b4cb7c824c6ed6c6ecc8783b8843212387f4cb08223fc157b40505",
  "lib/ediel/rulebook/deadlinePolicy.ts": "5fe8333f61a4460a979fc62f15f9b15ffafb2faa3702b09392a5042eb08b2f34",
  "lib/ediel/rulebook/canonicalEdielFacade.ts": "d395ebef617da8181879605aaf486cae889950316af7e1967d83525ece6a2d8f",
  "lib/ediel/rulebook/canonicalEdielPolicy.ts": "b0029c768fd81edced23b829732aa534b27fa8e81a8b803d21a63783ec432ec9",
  "lib/ediel/rulebook/canonicalRulePackRegistry.ts": "5b1d47c9379aa22ba8bc0df60de6fb158ef3f54c882951a9107bf7c618009976",
  "lib/ediel/messages.ts": "1bcfe177db9e7fad4a25342ce82a7c9b1cc5904428df26e2cf84ab9a9d02faa1",
  "lib/ediel/core/kernel.ts": "e375037eccec1bd140faeee524b86cc5ff9eec8b165e63c0cc9e8f4dcd5cc7b1",
  "lib/ediel/core/outboundOwnerWitness.ts": "a26cdec3e3c861aeffb3de18ef5e3d8d3fbd311d17106b3c3171c3d43657f0f6",
  "lib/ediel/core/edifactTokenizer.ts": "11b8b0546e794a2fe60c9aeaf6c3d811e9e6ca0e5a777171b4064a6679ced93f",
  "lib/ediel/core/edifactEnvelopeCodec.ts": "92834d6d359a15b85e8244683de7a4c9df3075403918a7cc088930ef495095ed",
  "lib/ediel/core/ackPolicy.ts": "daf2d4ad8b31b67263217f51590baae7f0039a629c24fcff42d13f7c7d40282f",
  "lib/ediel/db.ts": "45a44daa8eec2beca4e0fe70f40f4d0a9a09165df29f8025246704519e1cd1f0",
  "lib/ediel/outbox/createOutboxItem.ts": "412d05c89423ca9bee10fc7f18941b5c1e463b892ea796ca170f8909fd5b304a",
  "lib/cis/db-shared.ts": "289de6560100e5d6b2b8db620dfc093228fa62c5460b9e71b64fe5cc5bc351c2",
  "lib/cis/db-outbound.ts": "f061ca0f0c005861cd9c3a56f13ef6e59daf6264cce96607c4970c824865b05a",
  "lib/ediel/services/authorization.ts": "c1b2e9c04c0aa669584101b40f73c0c9df8506391e7fddd410c0bd40a7ff82a0",
  "lib/actor-registry/registryMarketSource.ts": "67e1f758203b88161989286e24e20b552b77c08ae2cbcdd161d8a13ce712c4a6",
  "lib/operations/db.part-1.ts": "831d39cc446d6c113b0b5b5263194236f57ea5ee33943573ac8177fe6004c4ff",
  "lib/operations/db.part-2.ts": "2ee2a9ece906c3b03d475d80d21ed142716a41167d24f9a7e8a105d0d5bbc462",
  "lib/masterdata/db.ts": "3d226006b66fe4c4b2567ed11e21ce1646976d1b517e0b38182bc76a1647bfcc",
  "supabase/schema.sql": "df4a353f3f2bb1bfd4eb0f4be99c76ee89a65ffb98bdc345f78c6924e5e65df6",
  "supabase/migrations/20260930213949_ediel_switch_intent_original_source_binding.sql": "f19b6a295147dd47d7a7ababa704d1f7aab19309831dcceb7e03769e3f9c3629",
  "supabase/migrations/20260930221158_ediel_source_qualified_switch_correction_binding.sql": "0446d3ed10cd2c53fd31abf972b6ea605282c3c3d0a6f62233b22fdf1f360d56",
  "supabase/migrations/20260930234708_ediel_normal_switch_signed_method_binding.sql": "a7612d2d02a753bdf55c2ea4e6213276e73c3082e94cf88934c28373c3abf2f2",
  "supabase/migrations/20261001011248_ediel_switch_production_brp_source_binding.sql": "b3b8d54ecf3b930a6244d91ac4f5e7b5e2c37631b230faeb5d0f3bd8a10a14c1",
  "supabase/migrations/20261001023248_ediel_bilateral_prodat_outbound_profile_original_owner.sql": "f85410f5504d43b518badefe98ffcea09e699bfc5d1a85a2b469c44b73b0ed3c",
  "supabase/migrations/20261001142640_ediel_switch_original_bind_composed_chain_restored.sql": "415bd6fa37e7ec012b733fff5625f4254c5f9f62d9e2a07025a50d9668f79042",
  "supabase/migrations/20261002233700_ediel_switch_original_bilateral_h_owner.sql": "15b55ade33e672e97a74a2b6c634f5125392f3a4cb16397840b793233a557e4a",
  "supabase/migrations/20260930201111_ediel_normal_switch_source_atomic_confirmation.sql": "c9b05a063c742d96fcb1521756859d92ffc3b3766cd949ad9103b83fa429df4d",
  "supabase/migrations/20260930161624_ediel_supply_market_source_lifecycle.sql": "38a50e4f52293755553eeab543e9831ed53f03277b24d7bd5bfc2a41e2efd7e7",
  "supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql": "99b0d6fda03afe1ecb9a8b3814a18d3127e657f1aaa3fbfd76543da7473124fa",
  "__tests__/ediel-normal-switch-intent-gateway.test.ts": "133484a71e41ad129df0f6c429f59ccac9ded0472ddb1ad0c5fc3e49c55d9c5e",
  "__tests__/ediel-prodat-register-compat-outbound.test.ts": "6912f7ed8c975c622b58d36c2f80ea8276a9fff04b56b634f1428224e8f5784c",
  "__tests__/ediel-contract-requested-method-source.test.ts": "fcd1c67eb9321f121ea207163463e44efc4dfa54bc32f6f1593762ca26658ada",
  "__tests__/ediel-brp-field-source.test.ts": "be632c703790cff89767eb83e162338aa74ff429ee98d3c5d5d3237dbe266af2",
  "__tests__/ediel-canonical-deadline-policy.test.ts": "e988e23837b4db7d774bf537c19bf111ca69ca811aa177b5e969c3fc40a65112",
  "__tests__/ediel-switch-outbound-reuse-environment.test.ts": "1c226df21ab1f064517a9df86631aa0b247ee8e42a0c46225fb36708e833cdd4",
  "__tests__/ediel-switch-cancellation-dispatch.test.ts": "c28f2c054bdfe7f40d93e5a4759ec78999f294a8e21e95f8de6152303677fe7e",
  "__tests__/ediel-source-switch-commit-observer.test.ts": "f48ef8a65447c49c263a3a4af080c31e1e7391af190daaf47a818e0579a5bf5e",
  "__tests__/ediel-bilateral-prodat-switch-preparation.test.ts": "b7b0dc31270235de34733c334814a15bce66e7bee1e856d3925eb31b8607df0a",
  "lib/ediel/prodat/canonicalRenderSemantics.ts": "02e7904aefa40024e322b2fe76300633d149ac47c70778a09076829fd602b44c"
}
```
